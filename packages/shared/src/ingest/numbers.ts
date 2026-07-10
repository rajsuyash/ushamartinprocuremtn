export type NumberErrorCode = "INVALID_NUMBER" | "NON_INTEGER_PRICE" | "NEGATIVE_QTY";

export type NumberParseResult<T> =
  | { ok: true; value: T }
  | { ok: false; code: NumberErrorCode };

const THOUSANDS_SEPARATOR = /,/g;
// ponytail: only rejects symbols actually seen in SAP exports; extend if a new one shows up.
const CURRENCY_SYMBOL = /[₹$€£]/;
const NUMERIC_PATTERN = /^-?\d+(\.\d+)?$/;

/** Strips thousands separators, rejects currency symbols, parses to a
 * finite number. Returns `null` (never `NaN`) on any failure — F2 known
 * pitfall: silent NaN from unparsed currency strings. */
function toCleanNumber(raw: string | number | Date): number | null {
  if (raw instanceof Date) return null;
  if (typeof raw === "number") return Number.isFinite(raw) ? raw : null;

  if (CURRENCY_SYMBOL.test(raw)) return null;
  const cleaned = raw.trim().replace(THOUSANDS_SEPARATOR, "");
  if (!NUMERIC_PATTERN.test(cleaned)) return null;

  const value = Number(cleaned);
  return Number.isFinite(value) ? value : null;
}

/** Money columns (`unit_price_inr`, `price_inr_mt`) must be integer INR. */
export function parseMoneyInteger(raw: string | number | Date): NumberParseResult<number> {
  const value = toCleanNumber(raw);
  if (value === null) return { ok: false, code: "INVALID_NUMBER" };
  return Number.isInteger(value)
    ? { ok: true, value }
    : { ok: false, code: "NON_INTEGER_PRICE" };
}

/** Qty columns (`qty_mt`) — decimal, 3dp preserved as a string (not a float,
 * to avoid precision drift when these get summed downstream). */
export function parseQtyDecimal(raw: string | number | Date): NumberParseResult<string> {
  const value = toCleanNumber(raw);
  if (value === null) return { ok: false, code: "INVALID_NUMBER" };
  if (value < 0) return { ok: false, code: "NEGATIVE_QTY" };
  return { ok: true, value: value.toFixed(3) };
}
