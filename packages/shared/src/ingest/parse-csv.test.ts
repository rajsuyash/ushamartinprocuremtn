import { Readable } from "node:stream";
import { describe, expect, it } from "vitest";
import { parseCsv } from "./parse-csv";
import { MissingColumnError } from "./types";

function toStream(csv: string): Readable {
  return Readable.from(csv);
}

describe("parseCsv", () => {
  it("parses a valid consumption CSV end to end", async () => {
    const csv = ["date,material_code,plant_code,qty_mt", "15-03-2026,WR-5.5-HC,RNC,412.5"].join("\n");

    const result = await parseCsv("consumption", toStream(csv));

    expect(result.errors).toEqual([]);
    expect(result.rows).toEqual([
      { date: "2026-03-15", material_code: "WR-5.5-HC", plant_code: "RNC", qty_mt: "412.500" },
    ]);
    expect(result.meta).toEqual({ fileType: "consumption", totalRows: 1, validRows: 1 });
  });

  it("strips a UTF-8 BOM from the header row", async () => {
    const csv = ["﻿date,material_code,plant_code,qty_mt", "15-03-2026,WR-5.5-HC,RNC,412.5"].join("\n");

    const result = await parseCsv("consumption", toStream(csv));

    expect(result.errors).toEqual([]);
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]).toMatchObject({ material_code: "WR-5.5-HC" });
  });

  it("rejects a currency symbol in a qty cell with a row error, not silent NaN", async () => {
    const csv = ["date,material_code,plant_code,qty_mt", "15-03-2026,WR-5.5-HC,RNC,₹412.5"].join("\n");

    const result = await parseCsv("consumption", toStream(csv));

    expect(result.rows).toEqual([]);
    expect(result.errors).toEqual([{ row: 1, code: "INVALID_NUMBER", detail: "qty_mt" }]);
  });

  it("throws MissingColumnError (F2-ERR1) when a required column is absent", async () => {
    const csv = ["date,material_code,qty_mt", "15-03-2026,WR-5.5-HC,412.5"].join("\n");

    await expect(parseCsv("consumption", toStream(csv))).rejects.toMatchObject({
      code: "MISSING_COLUMN",
      column: "plant_code",
    });
    await expect(parseCsv("consumption", toStream(csv))).rejects.toBeInstanceOf(MissingColumnError);
  });

  it("references the correct 1-indexed data row number for a malformed row further down the file", async () => {
    const rows = [
      "date,material_code,plant_code,qty_mt",
      "15-03-2026,WR-5.5-HC,RNC,10",
      "16-03-2026,WR-5.5-HC,RNC,20",
      "17-03-2026,WR-5.5-HC,RNC,-5",
      "18-03-2026,WR-5.5-HC,RNC,30",
    ];

    const result = await parseCsv("consumption", toStream(rows.join("\n")));

    expect(result.errors).toEqual([{ row: 3, code: "NEGATIVE_QTY", detail: "qty_mt" }]);
    expect(result.rows).toHaveLength(3);
    expect(result.meta).toEqual({ fileType: "consumption", totalRows: 4, validRows: 3 });
  });
});
