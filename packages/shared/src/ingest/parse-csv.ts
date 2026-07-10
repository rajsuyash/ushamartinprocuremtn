import Papa from "papaparse";
import type { Readable } from "node:stream";
import { FILE_CONTRACTS } from "./contracts";
import { normalizeRow } from "./normalize-row";
import { MissingColumnError } from "./types";
import type { FileType, ParseResult, ParsedRow, RowError } from "./types";

/** Streams a CSV `Readable` row by row through papaparse's `step` callback —
 * never buffers the whole file. UTF-8 BOM in the header is stripped by
 * papaparse itself before headers reach us. */
export function parseCsv(fileType: FileType, source: Readable): Promise<ParseResult> {
  const contract = FILE_CONTRACTS[fileType];

  return new Promise((resolve, reject) => {
    let settled = false;
    const settleResolve = (result: ParseResult): void => {
      if (settled) return;
      settled = true;
      resolve(result);
    };
    const settleReject = (error: unknown): void => {
      if (settled) return;
      settled = true;
      reject(error);
    };

    const rows: ParsedRow[] = [];
    const errors: RowError[] = [];
    let rowNumber = 0;
    let headerChecked = false;

    Papa.parse<Record<string, string>>(source, {
      header: true,
      skipEmptyLines: true,
      encoding: "utf-8",
      step: (results, parser) => {
        if (!headerChecked) {
          headerChecked = true;
          const fields = results.meta.fields ?? [];
          const missing = contract.columns.find((column) => !fields.includes(column));
          if (missing) {
            // Order matters: `parser.abort()` synchronously fires `complete()`
            // before returning control here, so settle the rejection first —
            // otherwise the `settled` guard lets the resolve from `complete()`
            // win the race.
            settleReject(new MissingColumnError(missing));
            parser.abort();
            return;
          }
        }

        rowNumber += 1;
        const { row, errors: rowErrors } = normalizeRow(fileType, results.data, rowNumber);
        if (row) rows.push(row);
        errors.push(...rowErrors);
      },
      complete: () => {
        settleResolve({ rows, errors, meta: { fileType, totalRows: rowNumber, validRows: rows.length } });
      },
      error: (error: Error) => settleReject(error),
    });
  });
}
