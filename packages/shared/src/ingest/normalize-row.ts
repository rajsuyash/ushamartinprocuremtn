import { FILE_CONTRACTS } from "./contracts";
import { parseDateCell } from "./dates";
import { parseMoneyInteger, parseQtyDecimal } from "./numbers";
import type { FileType, ParsedRow, RawRow, RowError } from "./types";

export interface NormalizeResult {
  /** `null` when the row has any error — only fully-valid rows are collected. */
  row: ParsedRow | null;
  errors: RowError[];
}

/** Applies the F2 file contract to one raw row: missing-value, date, money,
 * and qty checks. `rowNumber` is 1-indexed against data rows (header
 * excluded), consistent across the CSV and XLSX parsers. */
export function normalizeRow(fileType: FileType, raw: RawRow, rowNumber: number): NormalizeResult {
  const contract = FILE_CONTRACTS[fileType];
  const errors: RowError[] = [];
  const row: ParsedRow = {};

  for (const column of contract.columns) {
    const cell = raw[column];

    if (cell === null || cell === undefined || (typeof cell === "string" && cell.trim() === "")) {
      errors.push({ row: rowNumber, code: "MISSING_VALUE", detail: column });
      continue;
    }

    if (contract.dateColumns.includes(column)) {
      const result = parseDateCell(cell);
      if (result.ok) row[column] = result.iso;
      else errors.push({ row: rowNumber, code: result.code, detail: column });
      continue;
    }

    if (contract.moneyColumns.includes(column)) {
      const result = parseMoneyInteger(cell);
      if (result.ok) row[column] = result.value;
      else errors.push({ row: rowNumber, code: result.code, detail: column });
      continue;
    }

    if (contract.qtyColumns.includes(column)) {
      const result = parseQtyDecimal(cell);
      if (result.ok) row[column] = result.value;
      else errors.push({ row: rowNumber, code: result.code, detail: column });
      continue;
    }

    row[column] = cell instanceof Date ? cell.toISOString() : String(cell).trim();
  }

  return { row: errors.length === 0 ? row : null, errors };
}
