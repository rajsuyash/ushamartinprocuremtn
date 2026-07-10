import ExcelJS from "exceljs";
import type { Readable } from "node:stream";
import { FILE_CONTRACTS } from "./contracts";
import { normalizeRow } from "./normalize-row";
import { MissingColumnError } from "./types";
import type { CellValue, FileType, ParseResult, ParsedRow, RawRow, RowError } from "./types";

function extractHeaderNames(values: unknown[]): string[] {
  // `row.values` is 1-indexed; values[0] is always empty.
  return values.slice(1).map((value) => String(value ?? "").trim());
}

function cellsToRawRow(headers: string[], values: unknown[]): RawRow {
  const raw: RawRow = {};
  headers.forEach((header, index) => {
    raw[header] = values[index + 1] as CellValue;
  });
  return raw;
}

function isEntirelyBlank(raw: RawRow): boolean {
  return Object.values(raw).every((value) => value === null || value === undefined || value === "");
}

/**
 * Parses the first sheet of an XLSX file. Accepts a `Buffer` (typical for an
 * in-memory upload) or a `Readable`.
 *
 * ponytail: this used `ExcelJS.stream.xlsx.WorkbookReader` (the streaming
 * reader) first, per the task spec — but it's unreliable on this stack (Node
 * 25 / exceljs 4.4.0): a race in the reader's internal zip-entry state
 * machine throws `Cannot read properties of undefined (reading 'sheets')` on
 * ~30-40% of parses of byte-identical input (reproduced across 20+ repeated
 * reads of one buffer; retrying in-process made it worse, not better —
 * something about the failed attempts leaks state). `Workbook#xlsx.load` /
 * `#xlsx.read` — exceljs's regular, non-streaming reader — was 100% reliable
 * across the same test. F2-ERR3 already caps uploads at 20MB, which bounds
 * the in-memory cost of building the workbook object model, so correctness
 * wins here over the streaming ideal. Revisit if a future exceljs release
 * fixes the streaming reader race.
 */
export async function parseXlsx(fileType: FileType, source: Buffer | Readable): Promise<ParseResult> {
  const contract = FILE_CONTRACTS[fileType];
  const workbook = new ExcelJS.Workbook();

  if (Buffer.isBuffer(source)) {
    // Two @types/node versions are present in this workspace (14.x pulled in
    // transitively, 26.x at the root); exceljs's own .d.ts resolves its
    // ambient `Buffer`/stream types against the older one, so they're
    // nominally distinct from ours even though they describe the same
    // runtime value. Double-cast the method reference (not the value) via
    // `unknown` to bridge this one boundary call without weakening any of
    // our own types.
    await (workbook.xlsx.load as unknown as (buffer: Buffer) => Promise<unknown>)(source);
  } else {
    await (workbook.xlsx.read as unknown as (stream: Readable) => Promise<unknown>)(source);
  }

  const worksheet = workbook.worksheets[0];
  const rows: ParsedRow[] = [];
  const errors: RowError[] = [];
  let rowNumber = 0;
  let headers: string[] = [];

  worksheet?.eachRow({ includeEmpty: false }, (row, sheetRowNumber) => {
    const values = row.values as unknown[];

    if (sheetRowNumber === 1) {
      headers = extractHeaderNames(values);
      const missing = contract.columns.find((column) => !headers.includes(column));
      if (missing) throw new MissingColumnError(missing);
      return;
    }

    const raw = cellsToRawRow(headers, values);
    if (isEntirelyBlank(raw)) return;

    rowNumber += 1;
    const { row: normalized, errors: rowErrors } = normalizeRow(fileType, raw, rowNumber);
    if (normalized) rows.push(normalized);
    errors.push(...rowErrors);
  });

  if (headers.length === 0) {
    // No header row was ever read (empty or sheet-less file) — every
    // required column is absent.
    throw new MissingColumnError(contract.columns[0]);
  }

  return { rows, errors, meta: { fileType, totalRows: rowNumber, validRows: rows.length } };
}
