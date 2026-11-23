import { looksAlike, shortAddress } from "./address.js";
import { classifyToken, tokenAmount } from "./tokens.js";
import type {
  AddressMatch,
  Analysis,
  ClassifiedTransfer,
  Counterparty,
  Reason,
  Severity,
  SuspiciousAddress,
  TokenTransfer,
  TransferFlag,
} from "./types.js";

/** A real stablecoin transfer of at least this amount makes the other side a "real counterparty". */
export const TRUST_MIN_AMOUNT = 1;
/** Official-token transfers below this amount from unknown addresses are treated as dust. */
export const DUST_MAX_AMOUNT = 0.01;

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

export const SEVERITY_RANK: Record<Severity | "none", number> = {
  none: 0,
  low: 1,
  medium: 2,
  high: 3,
  critical: 4,
};

const ALL_FLAGS: TransferFlag[] = [
  "sent-to-lookalike",
  "lookalike",
  "fake-token",
  "zero-value",
  "spoofed-outgoing",
  "dust",
];

interface Base {
  transfer: TokenTransfer;
  direction: "in" | "out";
  counterparty: string;
  tokenKind: ClassifiedTransfer["tokenKind"];
  amount: number;
}

function toBase(user: string, transfer: TokenTransfer): Base | null {
  const from = transfer.from.toLowerCase();
  const to = transfer.to.toLowerCase();
  if (from === to) return null;
  let direction: "in" | "out";
  let counterparty: string;
  if (from === user) {
    direction = "out";
    counterparty = to;
  } else if (to === user) {
    direction = "in";
    counterparty = from;
  } else {
    return null;
  }
  return {
    transfer,
    direction,
    counterparty,
    tokenKind: classifyToken(transfer.token),
    amount: tokenAmount(transfer.rawValue, transfer.token.decimals),
  };
}

function isRealPayment(item: Base): boolean {
  return item.tokenKind === "official" && item.amount >= TRUST_MIN_AMOUNT && item.counterparty !== ZERO_ADDRESS;
}

function isPoisonLike(item: Base): boolean {
  if (item.tokenKind === "impersonator") return true;
  return item.tokenKind === "official" && item.amount < DUST_MAX_AMOUNT;
}

function buildCounterparties(items: Base[]): Map<string, Counterparty & { firstSeen: string }> {
  const map = new Map<string, Counterparty & { firstSeen: string }>();
  for (const item of items) {
    if (!isRealPayment(item)) continue;
    const ts = item.transfer.timestamp;
    const entry = map.get(item.counterparty) ?? {
      address: item.counterparty,
      transfers: 0,
      sent: 0,
      received: 0,
      lastSeen: ts,
      firstSeen: ts,
    };
    entry.transfers += 1;
    if (item.direction === "out") entry.sent += item.amount;
    else entry.received += item.amount;
    if (ts > entry.lastSeen) entry.lastSeen = ts;
    if (ts < entry.firstSeen) entry.firstSeen = ts;
    map.set(item.counterparty, entry);
  }
  return map;
}

/** Earliest time a poisoning-style transfer (zero, dust, fake token) involved this address. */
function firstPoisonTime(items: Base[], address: string): string | undefined {
  let first: string | undefined;
  for (const item of items) {
    if (item.counterparty !== address || !isPoisonLike(item)) continue;
    if (!first || item.transfer.timestamp < first) first = item.transfer.timestamp;
  }
  return first;
}

/**
 * When two real counterparties look alike, one of them is probably an attacker the user
 * paid by mistake. The impostor is the one that first showed up through a poisoning-style
 * transfer; otherwise the later one (the original usually came first).
 */
function splitImpostors(
  items: Base[],
  candidates: Map<string, Counterparty & { firstSeen: string }>,
): { trusted: Map<string, Counterparty & { firstSeen: string }>; impostors: Map<string, string> } {
  const list = [...candidates.values()].sort((a, b) => (a.firstSeen < b.firstSeen ? -1 : 1));
  const impostors = new Map<string, string>();
  for (let i = 0; i < list.length; i++) {
    for (let j = i + 1; j < list.length; j++) {
      const a = list[i]!;
      const b = list[j]!;
      if (impostors.has(a.address) || impostors.has(b.address)) continue;
      if (!looksAlike(a.address, b.address)) continue;
      const poisonA = firstPoisonTime(items, a.address);
      const poisonB = firstPoisonTime(items, b.address);
      const aPoisonFirst = poisonA !== undefined && poisonA <= a.firstSeen;
      const bPoisonFirst = poisonB !== undefined && poisonB <= b.firstSeen;
      if (aPoisonFirst && !bPoisonFirst) impostors.set(a.address, b.address);
      else impostors.set(b.address, a.address);
    }
  }
  const trusted = new Map(candidates);
  for (const address of impostors.keys()) trusted.delete(address);
  return { trusted, impostors };
}

function bestMatch(
  address: string,
  user: string,
  trusted: Iterable<string>,
  impostorOf?: string,
): AddressMatch | undefined {
  let best: AddressMatch | undefined;
  const consider = (original: string, relation: AddressMatch["relation"]) => {
    const m = looksAlike(address, original);
    if (!m) return;
    if (!best || m.prefix + m.suffix > best.prefix + best.suffix) {
      best = { original, prefix: m.prefix, suffix: m.suffix, relation };
    }
  };
  if (impostorOf) consider(impostorOf, "counterparty");
  for (const original of trusted) consider(original, "counterparty");
  consider(user, "self");
  return best;
}

/** Several poisoning addresses that copy each other usually target one real address outside the scan window. */
function suspectMatch(address: string, poisoned: Set<string>): AddressMatch | undefined {
  let best: AddressMatch | undefined;
  for (const other of poisoned) {
    const m = looksAlike(address, other);
    if (m && (!best || m.prefix + m.suffix > best.prefix + best.suffix)) {
      best = { original: other, prefix: m.prefix, suffix: m.suffix, relation: "other-suspect" };
    }
  }
  return best;
}

function formatAmount(value: number): string {
  return value.toLocaleString("en-US", { maximumFractionDigits: 2 });
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

function describe(
  flag: TransferFlag,
  list: ClassifiedTransfer[],
  match: AddressMatch | undefined,
): string {
  const n = list.length;
  switch (flag) {
    case "lookalike":
      if (!match) return "Looks like another address in this history.";
      if (match.relation === "self") {
        return `Looks like the analysed address itself: same first ${match.prefix} and last ${match.suffix} characters. Attackers do this so the address feels familiar.`;
      }
      if (match.relation === "other-suspect") {
        return `Shares the first ${match.prefix} and last ${match.suffix} characters with another suspicious address (${shortAddress(match.original)}). Attackers often create several lookalikes of one real address; that real address may be older than the transfers scanned here.`;
      }
      return `Looks like your real counterparty ${shortAddress(match.original)}: same first ${match.prefix} and last ${match.suffix} characters. In a wallet that shortens addresses, the two look identical.`;
    case "fake-token": {
      const symbols = [...new Set(list.map((t) => JSON.stringify(t.transfer.token.symbol)))].slice(0, 3).join(", ");
      return `${plural(n, "transfer")} of a fake stablecoin (${symbols}) from a contract that is not the real USDT or USDC. The token name is made to look real; it has no value.`;
    }
    case "zero-value":
      return `${plural(n, "transfer")} of exactly 0 USDT/USDC. Anyone can create these without your key; they only exist to plant this address in your history.`;
    case "spoofed-outgoing":
      return `${plural(n, "transfer")} show up as if sent from your address, but a zero-value or fake-token transfer does not need your signature. If you did not send them, someone forged them.`;
    case "dust":
      return `${plural(n, "tiny transfer")} (under ${DUST_MAX_AMOUNT}) of real USDT/USDC from an address you have never actually paid or been paid by.`;
    case "sent-to-lookalike": {
      const total = list.reduce((sum, t) => sum + t.amount, 0);
      const target = match ? ` If you meant to pay ${shortAddress(match.original)}, these funds probably went to an attacker.` : "";
      return `You sent ${formatAmount(total)} in real USDT/USDC to this lookalike address.${target}`;
    }
  }
}

function severityOf(flags: Set<TransferFlag>): Severity {
  if (flags.has("sent-to-lookalike")) return "critical";
  const poison = flags.has("fake-token") || flags.has("zero-value") || flags.has("dust");
  if (flags.has("lookalike") && poison) return "high";
  if (flags.has("lookalike") || flags.has("fake-token") || flags.has("zero-value")) return "medium";
  return "low";
}

export function analyzeTransfers(address: string, transfers: TokenTransfer[]): Analysis {
  const user = address.toLowerCase();
  const seen = new Set<string>();
  const items: Base[] = [];
  for (const transfer of transfers) {
    const key = `${transfer.txHash.toLowerCase()}:${transfer.logIndex}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const base = toBase(user, transfer);
    if (base) items.push(base);
  }
  items.sort((a, b) => (a.transfer.timestamp < b.transfer.timestamp ? 1 : a.transfer.timestamp > b.transfer.timestamp ? -1 : 0));

  const candidates = buildCounterparties(items);
  const { trusted, impostors } = splitImpostors(items, candidates);

  const poisoned = new Set(items.filter(isPoisonLike).map((item) => item.counterparty));
  for (const address of trusted.keys()) poisoned.delete(address);

  const matchCache = new Map<string, AddressMatch | undefined>();
  const matchOf = (counterparty: string): AddressMatch | undefined => {
    if (trusted.has(counterparty)) return undefined;
    if (!matchCache.has(counterparty)) {
      let match = bestMatch(counterparty, user, trusted.keys(), impostors.get(counterparty));
      if (!match && poisoned.has(counterparty)) match = suspectMatch(counterparty, poisoned);
      matchCache.set(counterparty, match);
    }
    return matchCache.get(counterparty);
  };

  const classified: ClassifiedTransfer[] = items.map((item) => {
    const flags: TransferFlag[] = [];
    const isTrusted = trusted.has(item.counterparty);
    const match = matchOf(item.counterparty);
    if (item.tokenKind === "impersonator") flags.push("fake-token");
    if (item.tokenKind === "official" && item.amount === 0) flags.push("zero-value");
    if (item.tokenKind === "official" && item.amount > 0 && item.amount < DUST_MAX_AMOUNT && !isTrusted) {
      flags.push("dust");
    }
    if (item.direction === "out" && (flags.includes("fake-token") || flags.includes("zero-value"))) {
      flags.push("spoofed-outgoing");
    }
    if (match) flags.push("lookalike");
    if (match && item.direction === "out" && item.tokenKind === "official" && item.amount >= DUST_MAX_AMOUNT) {
      flags.push("sent-to-lookalike");
    }
    return { ...item, flags };
  });

  const groups = new Map<string, ClassifiedTransfer[]>();
  for (const item of classified) {
    if (item.flags.length === 0) continue;
    const list = groups.get(item.counterparty) ?? [];
    list.push(item);
    groups.set(item.counterparty, list);
  }

  const suspicious: SuspiciousAddress[] = [];
  for (const [counterparty, list] of groups) {
    const match = matchOf(counterparty);
    const flagSet = new Set<TransferFlag>(list.flatMap((t) => t.flags));
    const reasons: Reason[] = [];
    for (const flag of ALL_FLAGS) {
      if (!flagSet.has(flag)) continue;
      const withFlag = list.filter((t) => t.flags.includes(flag));
      reasons.push({ flag, count: withFlag.length, text: describe(flag, withFlag, match) });
    }
    const times = list.map((t) => t.transfer.timestamp).sort();
    suspicious.push({
      address: counterparty,
      severity: severityOf(flagSet),
      match,
      reasons,
      transferCount: list.length,
      firstSeen: times[0]!,
      lastSeen: times[times.length - 1]!,
      txHashes: [...new Set(list.map((t) => t.transfer.txHash))].slice(0, 20),
    });
  }
  suspicious.sort(
    (a, b) =>
      SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity] ||
      b.transferCount - a.transferCount ||
      (a.lastSeen < b.lastSeen ? 1 : -1),
  );

  const counts = Object.fromEntries(ALL_FLAGS.map((f) => [f, 0])) as Record<TransferFlag, number>;
  for (const item of classified) for (const flag of item.flags) counts[flag] += 1;

  const risk = suspicious.reduce<Severity | "none">(
    (acc, s) => (SEVERITY_RANK[s.severity] > SEVERITY_RANK[acc] ? s.severity : acc),
    "none",
  );

  const trustedList = [...trusted.values()]
    .map(({ firstSeen: _firstSeen, ...rest }) => rest)
    .sort((a, b) => b.transfers - a.transfers || (a.lastSeen < b.lastSeen ? 1 : -1));

  return {
    address: user,
    transfersScanned: items.length,
    newest: items[0]?.transfer.timestamp,
    oldest: items[items.length - 1]?.transfer.timestamp,
    trusted: trustedList,
    suspicious,
    transfers: classified,
    risk,
    counts,
  };
}
