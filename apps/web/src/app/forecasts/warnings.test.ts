import { describe, expect, it } from "vitest";

import { hasInsufficientHistoryWarning, type RunWarning } from "./warnings";

const SERIES = { materialCode: "WR-5.5-HC", plantCode: "RNC" };

describe("hasInsufficientHistoryWarning", () => {
  it("is false for an empty warnings list", () => {
    expect(hasInsufficientHistoryWarning([], SERIES)).toBe(false);
  });

  it("is true when a matching INSUFFICIENT_HISTORY warning exists", () => {
    const warnings: RunWarning[] = [
      { code: "INSUFFICIENT_HISTORY", material_code: "WR-5.5-HC", plant_code: "RNC" },
    ];
    expect(hasInsufficientHistoryWarning(warnings, SERIES)).toBe(true);
  });

  it("is false when the warning is for a different series", () => {
    const warnings: RunWarning[] = [
      { code: "INSUFFICIENT_HISTORY", material_code: "WR-5.5-HC", plant_code: "OTHER" },
    ];
    expect(hasInsufficientHistoryWarning(warnings, SERIES)).toBe(false);
  });

  it("is false when the code differs (e.g. SERIES_FAILED)", () => {
    const warnings: RunWarning[] = [
      { code: "SERIES_FAILED", material_code: "WR-5.5-HC", plant_code: "RNC" },
    ];
    expect(hasInsufficientHistoryWarning(warnings, SERIES)).toBe(false);
  });

  it("ignores unrelated warnings mixed in", () => {
    const warnings: RunWarning[] = [
      { code: "ENGINE_UNAVAILABLE", stage: "price" },
      { code: "INSUFFICIENT_HISTORY", material_code: "WR-5.5-HC", plant_code: "RNC" },
    ];
    expect(hasInsufficientHistoryWarning(warnings, SERIES)).toBe(true);
  });
});
