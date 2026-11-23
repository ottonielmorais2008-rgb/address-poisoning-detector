import { describe, expect, it } from "vitest";
import { commonPrefix, commonSuffix, isAddress, looksAlike, normalizeAddress, shortAddress } from "../src/lib/address.js";

describe("address helpers", () => {
  it("validates and normalizes addresses", () => {
    expect(isAddress("0xCFDE810678842889CaBb354F29340C34e9E639DA")).toBe(true);
    expect(isAddress("0x123")).toBe(false);
    expect(isAddress("CFDE810678842889CaBb354F29340C34e9E639DA")).toBe(false);
    expect(normalizeAddress("  0xABCDEF0000000000000000000000000000000001 ")).toBe("0xabcdef0000000000000000000000000000000001");
    expect(normalizeAddress("vitalik.eth")).toBeNull();
  });

  it("counts shared prefix and suffix ignoring case", () => {
    const a = "0x96C4e431aB4D85522bbc83eb7514a7a00d6bEf98";
    const b = "0x96c407Df5FE41F8Fc262b4552845caed6B6bef98";
    expect(commonPrefix(a, b)).toBe(4);
    expect(commonSuffix(a, b)).toBe(6);
  });

  it("flags vanity lookalikes but not unrelated or identical addresses", () => {
    const real = "0x96C4e431aB4D85522bbc83eb7514a7a00d6bEf98";
    expect(looksAlike(real, "0x96C4A1272Ec2985Dbe8c700b22e2a1d7917EEf98")).toEqual({ prefix: 4, suffix: 4 });
    expect(looksAlike(real, real.toLowerCase())).toBeNull();
    expect(looksAlike(real, "0x1234567890123456789012345678901234567890")).toBeNull();
    // 3 + 3 is not enough on its own.
    expect(looksAlike("0xabc0000000000000000000000000000000000def", "0xabc1111111111111111111111111111111111def")).toBeNull();
  });

  it("accepts lopsided matches with 2 leading and 6 trailing characters", () => {
    expect(looksAlike("0x96C4e431aB4D85522bbc83eb7514a7a00d6bEf98", "0x964B95a5Dc7509DC6740b55fF4bA03c5eF6bEF98")).toEqual({
      prefix: 2,
      suffix: 6,
    });
  });

  it("shortens addresses for display", () => {
    expect(shortAddress("0xCFDE810678842889CaBb354F29340C34e9E639DA")).toBe("0xCFDE…39DA");
    expect(shortAddress("0x12")).toBe("0x12");
  });
});
