import type { Readable } from "node:stream";
import { parseCsv } from "./parse-csv";
import { parseXlsx } from "./parse-xlsx";
import type { FileType, ParseResult } from "./types";

export type UploadFormat = "csv" | "xlsx";

/**
 * Entry point for F2 file ingestion. `format` picks the parser; `source` is
 * the raw upload body — a `Readable` for CSV, a `Buffer` or `Readable` for
 * XLSX (first sheet only). Never materializes the whole file: both parsers
 * stream row by row. Only rows that pass every check end up in `rows`;
 * everything else surfaces in `errors` by row number. Throws
 * `MissingColumnError` (F2-ERR1) if a required column is absent from the
 * header.
 */
export function parseUpload(
  fileType: FileType,
  format: UploadFormat,
  source: Readable | Buffer,
): Promise<ParseResult> {
  if (format === "xlsx") return parseXlsx(fileType, source);

  if (Buffer.isBuffer(source)) {
    return Promise.reject(new TypeError("CSV parsing requires a Readable stream, not a Buffer"));
  }
  return parseCsv(fileType, source);
}
