import { isAddress } from "./address.js";
import type { Analysis, Severity, TransferFlag } from "./types.js";

export const MAX_SUMMARY_CHARS = 8_000;
export const MAX_SUMMARY_FINDINGS = 8;

export interface FindingSummary {
  address: string;
  severity: Severity;
  imitates?: string;
  imitatesRelation?: "counterparty" | "self" | "other-suspect";
  matchingStart?: number;
  matchingEnd?: number;
  reasons: { flag: TransferFlag; count: number }[];
  transfers: number;
}

export interface AnalysisSummary {
  address: string;
  risk: Severity | "none";
  transfersScanned: number;
  newest?: string;
  oldest?: string;
  realCounterparties: number;
  counts: Partial<Record<TransferFlag, number>>;
  findings: FindingSummary[];
  omittedFindings: number;
}

const SEVERITIES = new Set(["critical", "high", "medium", "low", "none"]);
const FLAGS = new Set(["fake-token", "zero-value", "dust", "spoofed-outgoing", "lookalike", "sent-to-lookalike"]);

export function summarize(analysis: Analysis): AnalysisSummary {
  const counts: Partial<Record<TransferFlag, number>> = {};
  for (const [flag, count] of Object.entries(analysis.counts) as [TransferFlag, number][]) {
    if (count > 0) counts[flag] = count;
  }
  return {
    address: analysis.address,
    risk: analysis.risk,
    transfersScanned: analysis.transfersScanned,
    newest: analysis.newest?.slice(0, 10),
    oldest: analysis.oldest?.slice(0, 10),
    realCounterparties: analysis.trusted.length,
    counts,
    findings: analysis.suspicious.slice(0, MAX_SUMMARY_FINDINGS).map((s) => ({
      address: s.address,
      severity: s.severity,
      imitates: s.match?.original,
      imitatesRelation: s.match?.relation,
      matchingStart: s.match?.prefix,
      matchingEnd: s.match?.suffix,
      reasons: s.reasons.map((r) => ({ flag: r.flag, count: r.count })),
      transfers: s.transferCount,
    })),
    omittedFindings: Math.max(0, analysis.suspicious.length - MAX_SUMMARY_FINDINGS),
  };
}

/** Validate an untrusted summary (from the browser) before it reaches the model. */
export function validateSummary(value: unknown): AnalysisSummary | null {
  if (!value || typeof value !== "object") return null;
  const v = value as AnalysisSummary;
  if (typeof v.address !== "string" || !isAddress(v.address)) return null;
  if (typeof v.risk !== "string" || !SEVERITIES.has(v.risk)) return null;
  if (!Number.isFinite(v.transfersScanned) || v.transfersScanned < 0) return null;
  if (!Array.isArray(v.findings) || v.findings.length > MAX_SUMMARY_FINDINGS) return null;
  for (const f of v.findings) {
    if (!f || typeof f !== "object") return null;
    if (typeof f.address !== "string" || !isAddress(f.address)) return null;
    if (typeof f.severity !== "string" || !SEVERITIES.has(f.severity)) return null;
    if (f.imitates !== undefined && (typeof f.imitates !== "string" || !isAddress(f.imitates))) return null;
    if (!Array.isArray(f.reasons) || f.reasons.some((r) => !r || !FLAGS.has(r.flag) || !Number.isFinite(r.count))) {
      return null;
    }
  }
  return v;
}

export function serializeSummary(summary: AnalysisSummary): string {
  return JSON.stringify(summary);
}
