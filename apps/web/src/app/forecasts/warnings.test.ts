import { describe, expect, it } from "vitest";

import { hasBaselineFallbackWarning, hasInsufficientHistoryWarning, type RunWarning } from "./warnings";

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

describe("hasBaselineFallbackWarning", () => {
  it("is false for an empty warnings list", () => {
    expect(hasBaselineFallbackWarning([], "WR-STD")).toBe(false);
  });

  it("is true when a matching BASELINE_FALLBACK warning exists", () => {
    const warnings: RunWarning[] = [{ code: "BASELINE_FALLBACK", grade_family: "WR-STD" }];
    expect(hasBaselineFallbackWarning(warnings, "WR-STD")).toBe(true);
  });

  it("is false when the warning is for a different grade_family", () => {
    const warnings: RunWarning[] = [{ code: "BASELINE_FALLBACK", grade_family: "WR-LRPC" }];
    expect(hasBaselineFallbackWarning(warnings, "WR-STD")).toBe(false);
  });

  it("is false when the code differs", () => {
    const warnings: RunWarning[] = [{ code: "INSUFFICIENT_HISTORY", grade_family: "WR-STD" }];
    expect(hasBaselineFallbackWarning(warnings, "WR-STD")).toBe(false);
  });
});
