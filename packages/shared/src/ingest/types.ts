/**
 * Streaming CSV/XLSX ingestion for the four PDI upload file types (PRD F2).
 *
 * Boundary: this module only does structural + per-row syntactic validation —
 * missing/extra columns, bad numbers, bad dates, negative qty. It never
 * touches the database, so lookup-style checks (`UNKNOWN_PLANT`, unknown
 * material/supplier codes, duplicate-key detection) are NOT its job. Those
 * run one layer up, after commit, against seeded reference data.
 */

export type FileType =
  | "purchase_orders"
  | "consumption"
  | "market_prices"
  | "inventory";

/** A single cell's raw value as it comes out of either parser. CSV cells are
 * always strings; XLSX cells may already be typed by exceljs (`number` for
 * plain numeric cells, `Date` for cells formatted as dates). */
export type CellValue = string | number | Date | null | undefined;

export type RawRow = Record<string, CellValue>;

/** A row that passed every check in this module — still string-keyed by the
 * original column name (snake_case, matching the file contract). Dates are
 * normalized ISO `YYYY-MM-DD` strings, qty columns are decimal strings with
 * 3dp preserved (never plain floats — avoids float-precision drift on sums
 * downstream), money columns are integers. */
export type ParsedRow = Record<string, string | number>;

export interface RowError {
  row: number;
  code: string;
  detail?: string;
}

export interface ParseMeta {
  fileType: FileType;
  totalRows: number;
  validRows: number;
}

export interface ParseResult {
  rows: ParsedRow[];
  errors: RowError[];
  meta: ParseMeta;
}

/** Thrown for F2-ERR1 — a required column is absent from the header row. */
export class MissingColumnError extends Error {
  readonly code = "MISSING_COLUMN";
  readonly column: string;

  constructor(column: string) {
    super(`Missing required column: ${column}`);
    this.name = "MissingColumnError";
    this.column = column;
  }
}
