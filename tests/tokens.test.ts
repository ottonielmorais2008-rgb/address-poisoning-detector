import { describe, expect, it } from "vitest";
import { classifyToken, skeleton, tokenAmount } from "../src/lib/tokens.js";
import { USDC, USDT } from "./helpers.js";

describe("token classification", () => {
  it("recognizes the official USDT and USDC contracts in any case", () => {
    expect(classifyToken(USDC)).toBe("official");
    expect(classifyToken({ ...USDT, address: USDT.address.toUpperCase().replace("0X", "0x") })).toBe("official");
  });

  it("flags tokens that copy the USDC/USDT symbol from another contract", () => {
    const fake = { address: "0x9c5c196000000000000000000000000000000000", symbol: "USDC", name: "USDC", decimals: 6 };
    expect(classifyToken(fake)).toBe("impersonator");
  });

  it("sees through homoglyphs and invisible characters seen in real attacks", () => {
    expect(skeleton("U\u206FS\u206FD\uA4DA")).toBe("USDC");
    expect(skeleton("ÚЅDС")).toBe("USDC");
    expect(skeleton("\uA4F4\u17B5\u054F\u13A0\u17B5\u13DF")).toBe("USDC");
    expect(skeleton("ＵＳＤＴ")).toBe("USDT");
    const fake = { address: "0x408726f200000000000000000000000000000000", symbol: "U\u206FS\u206FD\uA4DA", name: "x", decimals: 6 };
    expect(classifyToken(fake)).toBe("impersonator");
  });

  it("leaves unrelated tokens alone", () => {
    expect(classifyToken({ address: "0x6b175474e89094c44da98b954eedeac495271d0f", symbol: "DAI", name: "Dai", decimals: 18 })).toBe("other");
  });

  it("uses explorer scam labels only for USD-like tokens", () => {
    const base = { address: "0x5555555555555555555555555555555555555555", name: "Promo", decimals: 6, flaggedByExplorer: true };
    expect(classifyToken({ ...base, symbol: "USDx-claim" })).toBe("impersonator");
    expect(classifyToken({ ...base, symbol: "PEPE" })).toBe("other");
  });

  it("converts raw amounts with decimals", () => {
    expect(tokenAmount("153878065849", 6)).toBeCloseTo(153878.065849, 6);
    expect(tokenAmount("100", 6)).toBeCloseTo(0.0001, 10);
    expect(tokenAmount("0", 6)).toBe(0);
    expect(tokenAmount("not-a-number", 6)).toBe(0);
    expect(tokenAmount("5", 0)).toBe(5);
  });
});
