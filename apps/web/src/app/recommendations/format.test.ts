import { describe, expect, it } from "vitest";

import { formatImpactInr } from "./format";

describe("formatImpactInr", () => {
  it("groups a positive delta with the Indian lakh/crore convention", () => {
    expect(formatImpactInr(1234567)).toBe("₹12,34,567");
  });

  it("prefixes a negative delta (cost saving) with a minus sign", () => {
    // PRD F5 example costDeltaInr: -1,830,000.
    expect(formatImpactInr(-1_830_000)).toBe("-₹18,30,000");
  });

  it("formats zero without a sign", () => {
    expect(formatImpactInr(0)).toBe("₹0");
  });

  it("returns an em dash for null/undefined/non-finite", () => {
    expect(formatImpactInr(null)).toBe("—");
    expect(formatImpactInr(undefined)).toBe("—");
    expect(formatImpactInr(NaN)).toBe("—");
  });
});
