// Saves a trimmed copy of recent ERC-20 transfers for the demo address, so the page
// can show a result instantly even if the public explorer is slow. Usage:
//   node scripts/snapshot.mjs [address] [pages]
import { writeFile } from "node:fs/promises";

const DEMO = "0xCFDE810678842889CaBb354F29340C34e9E639DA";
const address = process.argv[2] ?? DEMO;
const pages = Number(process.argv[3] ?? 3);
const base = `https://eth.blockscout.com/api/v2/addresses/${address}/token-transfers`;

const trimAccount = (a) => ({ hash: a?.hash ?? null });
const trim = (item) => ({
  transaction_hash: item.transaction_hash,
  log_index: item.log_index,
  block_number: item.block_number,
  timestamp: item.timestamp,
  from: trimAccount(item.from),
  to: trimAccount(item.to),
  token: {
    address_hash: item.token?.address_hash ?? item.token?.address ?? null,
    symbol: item.token?.symbol ?? null,
    name: item.token?.name ?? null,
    decimals: item.token?.decimals ?? null,
    type: item.token?.type ?? null,
    reputation: item.token?.reputation ?? null,
  },
  total: { value: item.total?.value ?? null, decimals: item.total?.decimals ?? null },
});

const items = [];
let next = null;
for (let i = 0; i < pages; i++) {
  const query = new URLSearchParams({ type: "ERC-20", ...(next ?? {}) });
  let res;
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      res = await fetch(`${base}?${query}`, { headers: { Accept: "application/json" } });
      if (res.ok) break;
    } catch {
      // retry
    }
    await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
  }
  if (!res?.ok) throw new Error(`HTTP ${res?.status}`);
  const page = await res.json();
  items.push(...(page.items ?? []).map(trim));
  next = page.next_page_params ?? null;
  if (!next) break;
}

const out = { address, savedAt: new Date().toISOString(), items, next_page_params: next };
await writeFile("src/data/demo-snapshot.json", JSON.stringify(out) + "\n");
console.log(`Saved ${items.length} transfers for ${address}`);
