import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import { parseXlsx } from "./parse-xlsx";
import { MissingColumnError } from "./types";

async function buildWorkbookBuffer(rows: unknown[][]): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Sheet1");
  rows.forEach((row) => sheet.addRow(row));
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

describe("parseXlsx", () => {
  it("round-trips a Date-formatted cell and a plain numeric serial cell to the same ISO date", async () => {
    const buffer = await buildWorkbookBuffer([
      ["date", "material_code", "plant_code", "qty_mt"],
      [new Date(Date.UTC(2026, 2, 15)), "WR-5.5-HC", "RNC", 412.5],
      [46096, "WR-5.5-HC", "RNC", 100],
    ]);

    const result = await parseXlsx("consumption", buffer);

    expect(result.errors).toEqual([]);
    expect(result.rows).toEqual([
      { date: "2026-03-15", material_code: "WR-5.5-HC", plant_code: "RNC", qty_mt: "412.500" },
      { date: "2026-03-15", material_code: "WR-5.5-HC", plant_code: "RNC", qty_mt: "100.000" },
    ]);
  });

  it("parses an integer money cell and flags a fractional one", async () => {
    const buffer = await buildWorkbookBuffer([
      ["date", "source", "grade_family", "price_inr_mt"],
      [new Date(Date.UTC(2026, 2, 15)), "PLATTS", "WR-5.5", 54200],
      [new Date(Date.UTC(2026, 2, 16)), "PLATTS", "WR-5.5", 54200.5],
    ]);

    const result = await parseXlsx("market_prices", buffer);

    expect(result.rows).toEqual([
      { date: "2026-03-15", source: "PLATTS", grade_family: "WR-5.5", price_inr_mt: 54200 },
    ]);
    expect(result.errors).toEqual([{ row: 2, code: "NON_INTEGER_PRICE", detail: "price_inr_mt" }]);
  });

  it("throws MissingColumnError when a required header is absent", async () => {
    const buffer = await buildWorkbookBuffer([
      ["date", "material_code", "qty_mt"],
      [new Date(Date.UTC(2026, 2, 15)), "WR-5.5-HC", 10],
    ]);

    await expect(parseXlsx("consumption", buffer)).rejects.toBeInstanceOf(MissingColumnError);
  });
});
