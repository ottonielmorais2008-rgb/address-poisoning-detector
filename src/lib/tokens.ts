import type { TokenInfo, TokenKind } from "./types.js";

/** Official Ethereum mainnet stablecoin contracts (lower case). */
export const OFFICIAL_TOKENS: Record<string, "USDT" | "USDC"> = {
  "0xdac17f958d2ee523a2206206994597c13d831ec7": "USDT",
  "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48": "USDC",
};

/** Characters from other scripts that are drawn like the Latin letters in USDT/USDC. */
const CONFUSABLES: Record<string, string> = {
  // U
  "\uA4F4": "U", "\u054D": "U", "\u03C5": "U", "\u01B2": "U", "\u144C": "U", "\u222A": "U", "\u1D1C": "U",
  // S
  "\u0405": "S", "\u0455": "S", "\u054F": "S", "\u13DA": "S", "\uA4E2": "S", "\u01BD": "S",
  // D
  "\u13A0": "D", "\uA4D3": "D", "\u018A": "D", "\u15EA": "D", "\u00D0": "D", "\u0110": "D", "\u216E": "D",
  // T
  "\u0422": "T", "\u0442": "T", "\u03A4": "T", "\u03C4": "T", "\u13A2": "T", "\uA4D4": "T", "\u22A4": "T",
  // C
  "\u0421": "C", "\u0441": "C", "\u13DF": "C", "\uA4DA": "C", "\u03F9": "C", "\u216D": "C", "\u217D": "C",
};

/** Reduce a token symbol to plain A–Z/0–9 so homoglyph tricks (Cyrillic, invisible characters) collapse. */
export function skeleton(symbol: string): string {
  let out = "";
  for (const ch of symbol.normalize("NFKD")) {
    const mapped = CONFUSABLES[ch] ?? ch;
    if (/^[A-Za-z0-9]$/.test(mapped)) out += mapped.toUpperCase();
  }
  return out;
}

export function hasNonAscii(value: string): boolean {
  return /[^\x20-\x7E]/.test(value);
}

export function classifyToken(token: TokenInfo): TokenKind {
  const address = token.address.toLowerCase();
  if (OFFICIAL_TOKENS[address]) return "official";
  const symbol = skeleton(token.symbol);
  const name = skeleton(token.name);
  const imitatesSymbol = symbol === "USDT" || symbol === "USDC";
  const imitatesName = name === "TETHERUSD" || name === "USDC" || name === "USDCOIN" || name === "TETHER";
  if (imitatesSymbol || imitatesName) return "impersonator";
  if (token.flaggedByExplorer && /USD/.test(symbol)) return "impersonator";
  return "other";
}

export function tokenAmount(rawValue: string, decimals: number): number {
  let raw: bigint;
  try {
    raw = BigInt(rawValue || "0");
  } catch {
    return 0;
  }
  if (raw <= 0n) return 0;
  const safeDecimals = Math.max(0, Math.min(36, Math.floor(decimals || 0)));
  const base = 10n ** BigInt(safeDecimals);
  const whole = raw / base;
  const fraction = raw % base;
  return Number(whole) + (safeDecimals === 0 ? 0 : Number(fraction) / Number(base));
}
