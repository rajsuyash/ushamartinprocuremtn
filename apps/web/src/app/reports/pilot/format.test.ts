import { describe, expect, it } from "vitest";

import { formatMoneyInr, formatPct } from "./format";

describe("formatMoneyInr", () => {
  it("groups with Indian lakh/crore commas and a ₹ + space prefix (PRD F8-AC1)", () => {
    expect(formatMoneyInr(1_234_567)).toBe("₹ 12,34,567");
  });

  it("signs negative deltas", () => {
    expect(formatMoneyInr(-20_000)).toBe("-₹ 20,000");
  });

  it("returns an em dash for null/undefined (F8-ERR2 BASELINE_UNAVAILABLE rows)", () => {
    expect(formatMoneyInr(null)).toBe("—");
    expect(formatMoneyInr(undefined)).toBe("—");
  });

  it("returns zero cleanly", () => {
    expect(formatMoneyInr(0)).toBe("₹ 0");
  });
});

describe("formatPct", () => {
  it("formats to the requested decimal places", () => {
    expect(formatPct(13.5, 1)).toBe("13.5%");
    expect(formatPct(83, 0)).toBe("83%");
  });

  it("defaults to 1 decimal", () => {
    expect(formatPct(72.34)).toBe("72.3%");
  });

  it("returns an em dash for null/undefined", () => {
    expect(formatPct(null)).toBe("—");
    expect(formatPct(undefined)).toBe("—");
  });
});
