import { describe, expect, it } from "vitest";

import { formatQtyMt } from "./format";

describe("formatQtyMt", () => {
  it("trims trailing zeros but keeps one decimal", () => {
    expect(formatQtyMt(412.5)).toBe("412.5");
    expect(formatQtyMt("412.500")).toBe("412.5");
  });

  it("shows .0 for a whole number", () => {
    expect(formatQtyMt(412)).toBe("412.0");
    expect(formatQtyMt(0)).toBe("0.0");
  });

  it("keeps up to 3 decimals when needed", () => {
    expect(formatQtyMt(412.567)).toBe("412.567");
    expect(formatQtyMt(0.001)).toBe("0.001");
  });

  it("accepts numeric strings (Drizzle numeric columns)", () => {
    expect(formatQtyMt("103.250")).toBe("103.25");
  });

  it("returns an em dash for null/undefined/non-numeric", () => {
    expect(formatQtyMt(null)).toBe("—");
    expect(formatQtyMt(undefined)).toBe("—");
    expect(formatQtyMt("not-a-number")).toBe("—");
  });
});
