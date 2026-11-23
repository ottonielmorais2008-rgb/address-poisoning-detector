import { normalizeAddress } from "./address.js";
import type { TokenTransfer } from "./types.js";

export const BLOCKSCOUT_API = "https://eth.blockscout.com/api/v2";
export const PAGE_SIZE = 50;
export const DEFAULT_PAGES = 3;
export const MAX_PAGES = 10;

export interface BlockscoutAccount {
  hash?: string | null;
}

export interface BlockscoutTokenTransfer {
  transaction_hash?: string | null;
  log_index?: number | string | null;
  block_number?: number | string | null;
  timestamp?: string | null;
  from?: BlockscoutAccount | null;
  to?: BlockscoutAccount | null;
  token?: {
    address_hash?: string | null;
    address?: string | null;
    symbol?: string | null;
    name?: string | null;
    decimals?: string | number | null;
    type?: string | null;
    reputation?: string | null;
  } | null;
  total?: { value?: string | null; decimals?: string | number | null } | null;
}

export interface BlockscoutPage {
  items?: BlockscoutTokenTransfer[];
  next_page_params?: Record<string, string | number | null> | null;
}

export type PageParams = Record<string, string | number | null>;

export function parseTransfer(item: BlockscoutTokenTransfer): TokenTransfer | null {
  const txHash = item.transaction_hash?.trim().toLowerCase();
  const from = normalizeAddress(item.from?.hash ?? "");
  const to = normalizeAddress(item.to?.hash ?? "");
  const tokenAddress = normalizeAddress(item.token?.address_hash ?? item.token?.address ?? "");
  if (!txHash || !from || !to || !tokenAddress) return null;
  if (item.token?.type && item.token.type !== "ERC-20") return null;
  const rawValue = item.total?.value ?? "0";
  if (!/^\d+$/.test(rawValue)) return null;
  const decimals = Number(item.total?.decimals ?? item.token?.decimals ?? 0);
  return {
    txHash,
    logIndex: Number(item.log_index ?? 0) || 0,
    blockNumber: Number(item.block_number ?? 0) || 0,
    timestamp: item.timestamp ?? "",
    token: {
      address: tokenAddress,
      symbol: item.token?.symbol ?? "",
      name: item.token?.name ?? "",
      decimals: Number.isFinite(decimals) ? decimals : 0,
      flaggedByExplorer: item.token?.reputation === "scam" ? true : undefined,
    },
    rawValue,
    from,
    to,
  };
}

export function parsePage(page: BlockscoutPage): { transfers: TokenTransfer[]; next: PageParams | null } {
  const transfers = (page.items ?? []).map(parseTransfer).filter((t): t is TokenTransfer => t !== null);
  const next = page.next_page_params && Object.keys(page.next_page_params).length > 0 ? page.next_page_params : null;
  return { transfers, next };
}

export function pageUrl(address: string, params: PageParams | null): string {
  const query = new URLSearchParams({ type: "ERC-20" });
  if (params) {
    for (const [key, value] of Object.entries(params)) {
      if (value !== null && value !== undefined) query.set(key, String(value));
    }
  }
  return `${BLOCKSCOUT_API}/addresses/${address}/token-transfers?${query.toString()}`;
}

export class FetchError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "FetchError";
  }
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export async function fetchPage(
  address: string,
  params: PageParams | null,
  options: { fetchFn?: typeof fetch; timeoutMs?: number; retries?: number; retryDelayMs?: number } = {},
): Promise<{ transfers: TokenTransfer[]; next: PageParams | null }> {
  const fetchFn = options.fetchFn ?? fetch;
  const retries = options.retries ?? 2;
  const url = pageUrl(address, params);
  let lastError: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? 30_000);
    try {
      const response = await fetchFn(url, { signal: controller.signal, headers: { Accept: "application/json" } });
      if (response.status === 404) throw new FetchError("Address not found on the explorer.", 404);
      if (response.status === 429 || response.status >= 500) {
        throw new FetchError(`The public explorer is busy (HTTP ${response.status}).`, response.status);
      }
      if (!response.ok) throw new FetchError(`The public explorer returned HTTP ${response.status}.`, response.status);
      return parsePage((await response.json()) as BlockscoutPage);
    } catch (error) {
      lastError = error;
      const status = error instanceof FetchError ? error.status : undefined;
      if (status !== undefined && status < 500 && status !== 429) break;
      if (attempt < retries) await sleep((options.retryDelayMs ?? 800) * (attempt + 1));
    } finally {
      clearTimeout(timer);
    }
  }
  if (lastError instanceof FetchError) throw lastError;
  if (lastError instanceof Error && lastError.name === "AbortError") {
    throw new FetchError("The public explorer took too long to answer. Busy addresses can be slow; try again.");
  }
  throw new FetchError("Could not reach the public explorer. Check your connection and try again.");
}

export interface LoadResult {
  transfers: TokenTransfer[];
  next: PageParams | null;
  pages: number;
}

export async function loadTransfers(
  address: string,
  options: {
    pages?: number;
    start?: PageParams | null;
    fetchFn?: typeof fetch;
    onPage?: (loaded: number) => void;
    retryDelayMs?: number;
  } = {},
): Promise<LoadResult> {
  const pages = Math.max(1, Math.min(MAX_PAGES, options.pages ?? DEFAULT_PAGES));
  const transfers: TokenTransfer[] = [];
  let next: PageParams | null = options.start ?? null;
  let loaded = 0;
  for (let i = 0; i < pages; i++) {
    const page = await fetchPage(address, next, { fetchFn: options.fetchFn, retryDelayMs: options.retryDelayMs });
    transfers.push(...page.transfers);
    next = page.next;
    loaded += 1;
    options.onPage?.(loaded);
    if (!next) break;
  }
  return { transfers, next, pages: loaded };
}
