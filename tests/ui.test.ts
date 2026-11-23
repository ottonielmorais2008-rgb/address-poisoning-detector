import { describe, expect, it } from "vitest";
import { DEMO_ADDRESS, loadDemoSnapshot } from "../src/lib/demo.js";
import { analyzeTransfers } from "../src/lib/detect.js";
import { formatAmount, formatDate, formatDay, revealSymbol, splitForHighlight } from "../src/lib/format.js";
import { initialAddress, validateInput } from "../src/lib/ui-state.js";

describe("format helpers", () => {
  it("splits an address around the copied characters", () => {
    expect(splitForHighlight("0x96C4e431aB4D85522bbc83eb7514a7a00d6bEf98", 4, 4)).toEqual([
      "0x",
      "96C4",
      "e431aB4D85522bbc83eb7514a7a00d6b",
      "Ef98",
    ]);
    expect(splitForHighlight("0xabcd", 10, 10).join("")).toBe("0xabcd");
  });

  it("formats amounts and dates", () => {
    expect(formatAmount(0)).toBe("0");
    expect(formatAmount(0.000153)).toBe("0.00015");
    expect(formatAmount(153878.065849)).toBe("153,878.07");
    expect(formatDate("2026-11-23T16:37:11.000000Z")).toBe("2026-11-23 16:37 UTC");
    expect(formatDay(undefined)).toBe("—");
    expect(formatDate("nope")).toBe("—");
  });

  it("reveals invisible characters in fake token symbols", () => {
    expect(revealSymbol("USDC")).toBe("USDC");
    expect(revealSymbol("U\u206FS\u206FDC")).toBe("U[U+206F]S[U+206F]DC");
    expect(revealSymbol("")).toBe("(no symbol)");
  });
});

describe("ui state", () => {
  it("uses the demo address unless a valid address is in the URL", () => {
    expect(initialAddress("")).toEqual({ address: DEMO_ADDRESS, isDemo: true });
    expect(initialAddress("?address=nope")).toEqual({ address: DEMO_ADDRESS, isDemo: true });
    const other = "0x1111111111111111111111111111111111111111";
    expect(initialAddress(`?address=${other}`)).toEqual({ address: other, isDemo: false });
  });

  it("validates user input with helpful messages", () => {
    expect(validateInput("")).toMatchObject({ ok: false });
    expect(validateInput("vitalik.eth")).toMatchObject({ ok: false, error: expect.stringContaining("ENS") });
    expect(validateInput("0x123")).toMatchObject({ ok: false });
    expect(validateInput(` ${DEMO_ADDRESS} `)).toEqual({ ok: true, address: DEMO_ADDRESS });
  });
});

describe("demo snapshot", () => {
  it("shows a real poisoning campaign right away", () => {
    const demo = loadDemoSnapshot();
    expect(demo.address.toLowerCase()).toBe(DEMO_ADDRESS.toLowerCase());
    expect(demo.transfers.length).toBeGreaterThan(50);
    const result = analyzeTransfers(demo.address, demo.transfers);
    expect(["high", "critical"]).toContain(result.risk);
    expect(result.suspicious.length).toBeGreaterThan(3);
    expect(result.counts["fake-token"]).toBeGreaterThan(0);
    expect(result.suspicious.some((s) => s.match?.relation === "counterparty")).toBe(true);
  });
});
