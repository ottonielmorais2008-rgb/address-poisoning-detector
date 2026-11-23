import { normalizeAddress } from "./address.js";
import { DEMO_ADDRESS } from "./demo.js";

/** Address to scan on first load: ?address=… when valid, otherwise the demo address. */
export function initialAddress(search: string): { address: string; isDemo: boolean } {
  const param = new URLSearchParams(search).get("address");
  const normalized = param ? normalizeAddress(param) : null;
  if (normalized && normalized !== DEMO_ADDRESS.toLowerCase()) return { address: param!.trim(), isDemo: false };
  return { address: DEMO_ADDRESS, isDemo: true };
}

export function validateInput(value: string): { ok: true; address: string } | { ok: false; error: string } {
  const trimmed = value.trim();
  if (!trimmed) return { ok: false, error: "Paste an Ethereum address (0x followed by 40 hex characters)." };
  if (/\.eth$/i.test(trimmed)) return { ok: false, error: "ENS names are not supported yet. Paste the 0x address instead." };
  if (!normalizeAddress(trimmed)) {
    return { ok: false, error: "That is not a valid Ethereum address. It should be 0x followed by 40 hex characters." };
  }
  return { ok: true, address: trimmed };
}
