import snapshot from "../data/demo-snapshot.json";
import { parsePage, type BlockscoutPage, type PageParams } from "./blockscout.js";
import type { TokenTransfer } from "./types.js";

/**
 * A real mainnet address that is being targeted by an address poisoning campaign:
 * dozens of lookalike addresses send it dust, zero-value transfers and fake USDC.
 */
export const DEMO_ADDRESS = "0xCFDE810678842889CaBb354F29340C34e9E639DA";

export interface DemoSnapshot {
  address: string;
  savedAt: string;
  transfers: TokenTransfer[];
  next: PageParams | null;
}

export function loadDemoSnapshot(): DemoSnapshot {
  const raw = snapshot as unknown as BlockscoutPage & { address: string; savedAt: string };
  const { transfers, next } = parsePage(raw);
  return { address: raw.address, savedAt: raw.savedAt, transfers, next };
}
