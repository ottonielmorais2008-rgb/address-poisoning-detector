import { describe, expect, it } from "vitest";
import { analyzeTransfers } from "../src/lib/detect.js";
import { FAKE_FRIEND, FRIEND, ME, STRANGER, transfer, USDT } from "./helpers.js";

const FAKE_USDT = { address: "0x7777777777777777777777777777777777777777", symbol: "UЅDТ", name: "Tether", decimals: 6 };

describe("analyzeTransfers", () => {
  it("reports no risk for normal stablecoin activity", () => {
    const result = analyzeTransfers(ME, [
      transfer({ from: ME, to: FRIEND, amount: 250 }),
      transfer({ from: STRANGER, to: ME, amount: 1000, token: USDT }),
    ]);
    expect(result.risk).toBe("none");
    expect(result.suspicious).toHaveLength(0);
    expect(result.trusted.map((c) => c.address).sort()).toEqual([FRIEND, STRANGER].sort());
  });

  it("flags a lookalike that sends dust after a real payment", () => {
    const result = analyzeTransfers(ME, [
      transfer({ from: ME, to: FRIEND, amount: 5000, timestamp: "2026-10-01T10:00:00Z" }),
      transfer({ from: FAKE_FRIEND, to: ME, amount: 0.0001, timestamp: "2026-10-01T10:05:00Z" }),
    ]);
    expect(result.risk).toBe("high");
    const finding = result.suspicious[0]!;
    expect(finding.address).toBe(FAKE_FRIEND);
    expect(finding.match).toMatchObject({ original: FRIEND, prefix: 4, suffix: 5, relation: "counterparty" });
    expect(finding.reasons.map((r) => r.flag)).toEqual(["lookalike", "dust"]);
    expect(finding.reasons[0]!.text).toContain("same first 4 and last 5 characters");
  });

  it("marks zero-value transfers from the user as not signed by them", () => {
    const result = analyzeTransfers(ME, [
      transfer({ from: ME, to: FRIEND, amount: 10 }),
      transfer({ from: ME, to: FAKE_FRIEND, rawValue: "0" }),
    ]);
    const row = result.transfers.find((t) => t.counterparty === FAKE_FRIEND)!;
    expect(row.flags).toEqual(expect.arrayContaining(["zero-value", "spoofed-outgoing", "lookalike"]));
    expect(row.flags).not.toContain("sent-to-lookalike");
    expect(result.suspicious[0]!.severity).toBe("high");
  });

  it("flags fake stablecoins and never trusts their counterparties", () => {
    const result = analyzeTransfers(ME, [transfer({ from: ME, to: STRANGER, amount: 150000, token: FAKE_USDT })]);
    expect(result.trusted).toHaveLength(0);
    expect(result.counts["fake-token"]).toBe(1);
    expect(result.suspicious[0]!.severity).toBe("medium");
    expect(result.suspicious[0]!.reasons[0]!.text).toContain("fake stablecoin");
  });

  it("raises a critical alert when real funds go to a lookalike planted first by poisoning", () => {
    const result = analyzeTransfers(ME, [
      transfer({ from: ME, to: FRIEND, amount: 1000, timestamp: "2026-09-01T00:00:00Z" }),
      transfer({ from: FAKE_FRIEND, to: ME, rawValue: "0", timestamp: "2026-09-02T00:00:00Z" }),
      transfer({ from: ME, to: FAKE_FRIEND, amount: 20000, timestamp: "2026-09-03T00:00:00Z" }),
    ]);
    expect(result.risk).toBe("critical");
    expect(result.trusted.map((c) => c.address)).toEqual([FRIEND]);
    const finding = result.suspicious[0]!;
    expect(finding.address).toBe(FAKE_FRIEND);
    expect(finding.reasons[0]!.flag).toBe("sent-to-lookalike");
    expect(finding.reasons[0]!.text).toContain("20,000");
  });

  it("decides which of two paid lookalikes is the impostor by poisoning history", () => {
    // The impostor was paid first in this window, but it was planted by a zero transfer before that.
    const result = analyzeTransfers(ME, [
      transfer({ from: FAKE_FRIEND, to: ME, rawValue: "0", timestamp: "2026-09-01T00:00:00Z" }),
      transfer({ from: ME, to: FAKE_FRIEND, amount: 300, timestamp: "2026-09-02T00:00:00Z" }),
      transfer({ from: ME, to: FRIEND, amount: 300, timestamp: "2026-09-03T00:00:00Z" }),
    ]);
    expect(result.trusted.map((c) => c.address)).toEqual([FRIEND]);
    expect(result.suspicious[0]).toMatchObject({ address: FAKE_FRIEND, severity: "critical" });
  });

  it("flags addresses that imitate the scanned address itself", () => {
    const meLike = "0x1111aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa1111";
    const result = analyzeTransfers(ME, [transfer({ from: meLike, to: ME, amount: 0.001 })]);
    expect(result.suspicious[0]!.match?.relation).toBe("self");
  });

  it("groups lookalike suspects when the real target is outside the scan window", () => {
    const a = "0xa427da55393bd055c3bd839053ba127b66a904e2";
    const b = "0xa429920061b16264618e0ef1ba14c97857be04e2";
    const result = analyzeTransfers(ME, [
      transfer({ from: a, to: ME, amount: 0.0001 }),
      transfer({ from: b, to: ME, amount: 0.0001 }),
    ]);
    expect(result.suspicious).toHaveLength(2);
    for (const s of result.suspicious) {
      expect(s.match?.relation).toBe("other-suspect");
      expect(s.severity).toBe("high");
    }
  });

  it("ignores dust from known counterparties, duplicates and unrelated rows", () => {
    const repeated = transfer({ from: STRANGER, to: ME, amount: 0.0001 });
    const result = analyzeTransfers(ME, [
      transfer({ from: FRIEND, to: ME, amount: 50 }),
      transfer({ from: FRIEND, to: ME, amount: 0.001 }),
      repeated,
      repeated,
      transfer({ from: FRIEND, to: STRANGER, amount: 10 }),
      transfer({ from: ME, to: ME, amount: 10 }),
    ]);
    expect(result.transfersScanned).toBe(3);
    expect(result.counts.dust).toBe(1);
    expect(result.suspicious.map((s) => s.address)).toEqual([STRANGER]);
    expect(result.suspicious[0]!.severity).toBe("low");
  });

  it("sorts findings by severity and orders transfers newest first", () => {
    const result = analyzeTransfers(ME, [
      transfer({ from: STRANGER, to: ME, amount: 0.0001, timestamp: "2026-10-01T00:00:00Z" }),
      transfer({ from: ME, to: FRIEND, amount: 10, timestamp: "2026-10-02T00:00:00Z" }),
      transfer({ from: FAKE_FRIEND, to: ME, rawValue: "0", timestamp: "2026-10-03T00:00:00Z" }),
    ]);
    expect(result.suspicious.map((s) => s.severity)).toEqual(["high", "low"]);
    expect(result.newest).toBe("2026-10-03T00:00:00Z");
    expect(result.oldest).toBe("2026-10-01T00:00:00Z");
  });
});
