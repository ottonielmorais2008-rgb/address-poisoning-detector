import type { Severity, TransferFlag } from "./types.js";

export const ETHERSCAN = "https://etherscan.io";

export function addressUrl(address: string): string {
  return `${ETHERSCAN}/address/${address}`;
}

export function txUrl(hash: string): string {
  return `${ETHERSCAN}/tx/${hash}`;
}

export function formatAmount(value: number): string {
  if (value === 0) return "0";
  if (value < 0.01) return value.toLocaleString("en-US", { maximumSignificantDigits: 2 });
  return value.toLocaleString("en-US", { maximumFractionDigits: 2 });
}

export function formatDate(iso: string | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toISOString().slice(0, 16).replace("T", " ") + " UTC";
}

export function formatDay(iso: string | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toISOString().slice(0, 10);
}

/** Split an address into [0x, start, middle, end] so the copied start and end can be highlighted. */
export function splitForHighlight(address: string, prefix: number, suffix: number): [string, string, string, string] {
  const body = address.slice(2);
  const p = Math.max(0, Math.min(prefix, body.length));
  const s = Math.max(0, Math.min(suffix, body.length - p));
  return ["0x", body.slice(0, p), body.slice(p, body.length - s), body.slice(body.length - s)];
}

export const FLAG_LABEL: Record<TransferFlag, string> = {
  "sent-to-lookalike": "Sent to lookalike",
  lookalike: "Lookalike address",
  "fake-token": "Fake token",
  "zero-value": "Zero value",
  "spoofed-outgoing": "Not signed by you",
  dust: "Dust",
};

export const SEVERITY_LABEL: Record<Severity | "none", string> = {
  critical: "Critical",
  high: "High",
  medium: "Medium",
  low: "Low",
  none: "No signs found",
};

/** Make a token symbol safe to show: reveal invisible characters so a fake "USDC" does not look real. */
export function revealSymbol(symbol: string): string {
  const out: string[] = [];
  for (const ch of symbol) {
    const code = ch.codePointAt(0) ?? 0;
    if (code >= 0x20 && code <= 0x7e) out.push(ch);
    else if (/\p{L}|\p{N}/u.test(ch)) out.push(ch);
    else out.push(`[U+${code.toString(16).toUpperCase().padStart(4, "0")}]`);
  }
  return out.join("") || "(no symbol)";
}
