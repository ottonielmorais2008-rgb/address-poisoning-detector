export type TokenKind = "official" | "impersonator" | "other";

export interface TokenInfo {
  address: string;
  symbol: string;
  name: string;
  decimals: number;
  /** True when the explorer itself marks the token as a scam. */
  flaggedByExplorer?: boolean;
}

export interface TokenTransfer {
  txHash: string;
  logIndex: number;
  blockNumber: number;
  timestamp: string;
  token: TokenInfo;
  /** Raw integer amount as a decimal string (no decimals applied). */
  rawValue: string;
  /** Lower-case 0x address. */
  from: string;
  /** Lower-case 0x address. */
  to: string;
}

export type TransferFlag =
  | "fake-token"
  | "zero-value"
  | "dust"
  | "spoofed-outgoing"
  | "lookalike"
  | "sent-to-lookalike";

export type Severity = "critical" | "high" | "medium" | "low";

export interface AddressMatch {
  /** The trusted address this one imitates. */
  original: string;
  /** Number of matching hex characters at the start (after 0x). */
  prefix: number;
  /** Number of matching hex characters at the end. */
  suffix: number;
  /**
   * "counterparty": copies a real counterparty; "self": copies the analysed address;
   * "other-suspect": copies another suspicious address (the real target may be older than the scan window).
   */
  relation: "counterparty" | "self" | "other-suspect";
}

export interface ClassifiedTransfer {
  transfer: TokenTransfer;
  direction: "in" | "out";
  counterparty: string;
  tokenKind: TokenKind;
  /** Human amount (decimals applied). */
  amount: number;
  flags: TransferFlag[];
}

export interface Reason {
  flag: TransferFlag;
  count: number;
  text: string;
}

export interface SuspiciousAddress {
  address: string;
  severity: Severity;
  match?: AddressMatch;
  reasons: Reason[];
  transferCount: number;
  firstSeen: string;
  lastSeen: string;
  txHashes: string[];
}

export interface Counterparty {
  address: string;
  /** Real stablecoin transfers of at least TRUST_MIN_AMOUNT. */
  transfers: number;
  sent: number;
  received: number;
  lastSeen: string;
}

export interface Analysis {
  address: string;
  transfersScanned: number;
  oldest?: string;
  newest?: string;
  trusted: Counterparty[];
  suspicious: SuspiciousAddress[];
  transfers: ClassifiedTransfer[];
  risk: Severity | "none";
  counts: Record<TransferFlag, number>;
}
