import { Readable } from "node:stream";
import { describe, expect, it } from "vitest";
import { parseUpload } from "./parse-upload";

const ROW_COUNT = 50_000;

function buildSyntheticCsv(rowCount: number): { csv: string; badRow: number } {
  const lines = ["date,material_code,plant_code,qty_mt"];
  const badRow = 33_333;

  for (let i = 1; i <= rowCount; i += 1) {
    const day = String((i % 28) + 1).padStart(2, "0");
    const qty = i === badRow ? "-1" : "10.5";
    lines.push(`${day}-03-2026,WR-5.5-HC,RNC,${qty}`);
  }

  return { csv: lines.join("\n"), badRow };
}

describe("parseUpload", () => {
  it("dispatches to the CSV parser and rejects a Buffer source", async () => {
    await expect(
      parseUpload("consumption", "csv", Buffer.from("date,material_code,plant_code,qty_mt")),
    ).rejects.toThrow(/Readable stream/);
  });

  it("streams a 50k-row CSV, completing well under the 30s speed budget, with errors on the correct rows", async () => {
    const { csv, badRow } = buildSyntheticCsv(ROW_COUNT);

    const start = Date.now();
    const result = await parseUpload("consumption", "csv", Readable.from(csv));
    const elapsedMs = Date.now() - start;

    expect(elapsedMs).toBeLessThan(30_000);
    expect(result.meta.totalRows).toBe(ROW_COUNT);
    expect(result.meta.validRows).toBe(ROW_COUNT - 1);
    expect(result.errors).toEqual([{ row: badRow, code: "NEGATIVE_QTY", detail: "qty_mt" }]);
  }, 30_000);
});
