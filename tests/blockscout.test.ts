import { describe, expect, it, vi } from "vitest";
import { FetchError, loadTransfers, pageUrl, parsePage, parseTransfer } from "../src/lib/blockscout.js";

const item = {
  transaction_hash: "0xABC",
  log_index: 12,
  block_number: 26479073,
  timestamp: "2026-11-23T16:37:11.000000Z",
  from: { hash: "0x6892bA7fEBc703D19aEBb35b79846f1fE33153c8" },
  to: { hash: "0xCFDE810678842889CaBb354F29340C34e9E639DA" },
  token: { address_hash: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48", symbol: "USDC", name: "USDC", decimals: "6", type: "ERC-20" },
  total: { value: "249899995356", decimals: "6" },
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

describe("Blockscout parsing", () => {
  it("parses a token transfer into lower-case addresses", () => {
    expect(parseTransfer(item)).toEqual({
      txHash: "0xabc",
      logIndex: 12,
      blockNumber: 26479073,
      timestamp: "2026-11-23T16:37:11.000000Z",
      token: { address: "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48", symbol: "USDC", name: "USDC", decimals: 6, flaggedByExplorer: undefined },
      rawValue: "249899995356",
      from: "0x6892ba7febc703d19aebb35b79846f1fe33153c8",
      to: "0xcfde810678842889cabb354f29340c34e9e639da",
    });
  });

  it("drops malformed rows and keeps scam labels", () => {
    expect(parseTransfer({ ...item, from: null })).toBeNull();
    expect(parseTransfer({ ...item, total: { value: "-1" } })).toBeNull();
    expect(parseTransfer({ ...item, token: { ...item.token, type: "ERC-721" } })).toBeNull();
    expect(parseTransfer({ ...item, token: { ...item.token, reputation: "scam" } })?.token.flaggedByExplorer).toBe(true);
    const page = parsePage({ items: [item, { ...item, to: { hash: "bad" } }], next_page_params: {} });
    expect(page.transfers).toHaveLength(1);
    expect(page.next).toBeNull();
  });

  it("builds page URLs with ERC-20 filter and cursor params", () => {
    const url = pageUrl("0xabc", { block_number: 5, index: 7, skip: null });
    expect(url).toBe("https://eth.blockscout.com/api/v2/addresses/0xabc/token-transfers?type=ERC-20&block_number=5&index=7");
  });
});

describe("loadTransfers", () => {
  it("follows next_page_params up to the page limit", async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce(json({ items: [item], next_page_params: { block_number: 1, index: 2 } }))
      .mockResolvedValueOnce(json({ items: [{ ...item, log_index: 13 }], next_page_params: { block_number: 0, index: 1 } }));
    const pages: number[] = [];
    const result = await loadTransfers("0xabc", { pages: 2, fetchFn, onPage: (n) => pages.push(n) });
    expect(result.transfers).toHaveLength(2);
    expect(result.next).toEqual({ block_number: 0, index: 1 });
    expect(pages).toEqual([1, 2]);
    expect(fetchFn.mock.calls[1]![0]).toContain("block_number=1&index=2");
  });

  it("stops early when there are no more pages", async () => {
    const fetchFn = vi.fn().mockResolvedValue(json({ items: [item], next_page_params: null }));
    const result = await loadTransfers("0xabc", { pages: 3, fetchFn });
    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(result.pages).toBe(1);
  });

  it("retries busy responses and then succeeds", async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce(json({ message: "busy" }, 503))
      .mockResolvedValueOnce(json({ items: [item], next_page_params: null }));
    const result = await loadTransfers("0xabc", { pages: 1, fetchFn, retryDelayMs: 1 });
    expect(result.transfers).toHaveLength(1);
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it("does not retry client errors and explains them", async () => {
    const fetchFn = vi.fn().mockResolvedValue(json({}, 404));
    await expect(loadTransfers("0xabc", { fetchFn, retryDelayMs: 1 })).rejects.toBeInstanceOf(FetchError);
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it("reports network failures in plain words", async () => {
    const fetchFn = vi.fn().mockRejectedValue(new TypeError("fetch failed"));
    await expect(loadTransfers("0xabc", { fetchFn, retryDelayMs: 1 })).rejects.toThrow(/Could not reach the public explorer/);
    expect(fetchFn).toHaveBeenCalledTimes(3);
  });
});
