import { describe, expect, it } from "vitest";
import { normalizeRow } from "./normalize-row";

describe("normalizeRow", () => {
  it("returns a fully normalized row when every column is valid", () => {
    const result = normalizeRow(
      "consumption",
      { date: "15-03-2026", material_code: "WR-5.5-HC", plant_code: "RNC", qty_mt: "412.5" },
      1,
    );

    expect(result.errors).toEqual([]);
    expect(result.row).toEqual({
      date: "2026-03-15",
      material_code: "WR-5.5-HC",
      plant_code: "RNC",
      qty_mt: "412.500",
    });
  });

  it("flags a missing required value with MISSING_VALUE and the column name", () => {
    const result = normalizeRow(
      "consumption",
      { date: "15-03-2026", material_code: "", plant_code: "RNC", qty_mt: "412.5" },
      7,
    );

    expect(result.row).toBeNull();
    expect(result.errors).toEqual([{ row: 7, code: "MISSING_VALUE", detail: "material_code" }]);
  });

  it("flags a negative quantity and excludes the row from valid output", () => {
    const result = normalizeRow(
      "consumption",
      { date: "15-03-2026", material_code: "WR-5.5-HC", plant_code: "RNC", qty_mt: "-5" },
      3,
    );

    expect(result.row).toBeNull();
    expect(result.errors).toEqual([{ row: 3, code: "NEGATIVE_QTY", detail: "qty_mt" }]);
  });

  it("flags a bad date with INVALID_DATE", () => {
    const result = normalizeRow(
      "consumption",
      { date: "31-13-2026", material_code: "WR-5.5-HC", plant_code: "RNC", qty_mt: "5" },
      2,
    );

    expect(result.row).toBeNull();
    expect(result.errors).toEqual([{ row: 2, code: "INVALID_DATE", detail: "date" }]);
  });

  it("flags a fractional money column with NON_INTEGER_PRICE", () => {
    const result = normalizeRow(
      "market_prices",
      { date: "2026-03-15", source: "PLATTS", grade_family: "WR-5.5", price_inr_mt: "54200.50" },
      4,
    );

    expect(result.row).toBeNull();
    expect(result.errors).toEqual([{ row: 4, code: "NON_INTEGER_PRICE", detail: "price_inr_mt" }]);
  });

  it("collects every row-level error, not just the first", () => {
    const result = normalizeRow(
      "consumption",
      { date: "bad-date", material_code: "", plant_code: "RNC", qty_mt: "-5" },
      9,
    );

    expect(result.row).toBeNull();
    expect(result.errors).toEqual([
      { row: 9, code: "INVALID_DATE", detail: "date" },
      { row: 9, code: "MISSING_VALUE", detail: "material_code" },
      { row: 9, code: "NEGATIVE_QTY", detail: "qty_mt" },
    ]);
  });
});
