import type { TokenTransfer } from "../src/lib/types.js";

export const USDC = { address: "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48", symbol: "USDC", name: "USDC", decimals: 6 };
export const USDT = { address: "0xdac17f958d2ee523a2206206994597c13d831ec7", symbol: "USDT", name: "Tether USD", decimals: 6 };

export const ME = "0x1111111111111111111111111111111111111111";
export const FRIEND = "0xabcd5555555555555555555555555555555e9f01";
/** Same first 4 and last 5 characters as FRIEND. */
export const FAKE_FRIEND = "0xabcd0000000000000000000000000000000e9f01";
export const STRANGER = "0x9999999999999999999999999999999999999999";

let n = 0;

export function transfer(partial: Partial<TokenTransfer> & { from: string; to: string; amount?: number }): TokenTransfer {
  n += 1;
  const token = partial.token ?? USDC;
  const raw = partial.rawValue ?? String(Math.round((partial.amount ?? 0) * 10 ** token.decimals));
  return {
    txHash: partial.txHash ?? `0x${n.toString(16).padStart(64, "0")}`,
    logIndex: partial.logIndex ?? 0,
    blockNumber: partial.blockNumber ?? n,
    timestamp: partial.timestamp ?? `2026-10-${String(1 + (n % 27)).padStart(2, "0")}T12:00:00.000000Z`,
    token,
    rawValue: raw,
    from: partial.from,
    to: partial.to,
  };
}
