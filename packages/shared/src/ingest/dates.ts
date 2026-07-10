export type DateParseResult = { ok: true; iso: string } | { ok: false; code: "INVALID_DATE" };

// Howard Hinnant's civil_from_days / days_from_civil — pure integer proleptic
// Gregorian calendar math (http://howardhinnant.github.io/date_algorithms.html).
// XLSX serials and DD-MM/YYYY-MM strings both funnel through this day-count
// arithmetic — never a JS `Date` object — so there's no local-timezone shift
// to worry about (known pitfall F2: "never let JS Date timezone shift a
// business date").
function daysFromCivil(year: number, month: number, day: number): number {
  const y = month <= 2 ? year - 1 : year;
  const era = Math.floor((y >= 0 ? y : y - 399) / 400);
  const yoe = y - era * 400;
  const doy = Math.floor((153 * (month + (month > 2 ? -3 : 9)) + 2) / 5) + day - 1;
  const doe = yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy;
  return era * 146097 + doe - 719468;
}

function civilFromDays(z: number): { year: number; month: number; day: number } {
  const zAdj = z + 719468;
  const era = Math.floor((zAdj >= 0 ? zAdj : zAdj - 146096) / 146097);
  const doe = zAdj - era * 146097;
  const yoe = Math.floor(
    (doe - Math.floor(doe / 1460) + Math.floor(doe / 36524) - Math.floor(doe / 146096)) / 365,
  );
  const y = yoe + era * 400;
  const doy = doe - (365 * yoe + Math.floor(yoe / 4) - Math.floor(yoe / 100));
  const mp = Math.floor((5 * doy + 2) / 153);
  const day = doy - Math.floor((153 * mp + 2) / 5) + 1;
  const month = mp < 10 ? mp + 3 : mp - 9;
  const year = month <= 2 ? y + 1 : y;
  return { year, month, day };
}

function isValidCivilDate(year: number, month: number, day: number): boolean {
  if (month < 1 || month > 12 || day < 1) return false;
  const roundTrip = civilFromDays(daysFromCivil(year, month, day));
  return roundTrip.year === year && roundTrip.month === month && roundTrip.day === day;
}

// Excel/Lotus epoch. Serial 1 == 1900-01-01 (with the well-known fictitious
// 1900-02-29 baked in for serial 60) — irrelevant for any real business date,
// which is always well after March 1900.
const EXCEL_EPOCH_DAYS = daysFromCivil(1899, 12, 30);

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

function toIso(year: number, month: number, day: number): string {
  return `${String(year).padStart(4, "0")}-${pad2(month)}-${pad2(day)}`;
}

function fromSerial(serial: number): DateParseResult {
  if (!Number.isFinite(serial)) return { ok: false, code: "INVALID_DATE" };
  const { year, month, day } = civilFromDays(EXCEL_EPOCH_DAYS + Math.trunc(serial));
  return { ok: true, iso: toIso(year, month, day) };
}

const ISO_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const DD_MM_PATTERN = /^(\d{1,2})-(\d{1,2})-(\d{4})$/;
const SERIAL_PATTERN = /^\d+(\.\d+)?$/;

function fromString(raw: string): DateParseResult {
  const trimmed = raw.trim();

  const isoMatch = ISO_PATTERN.exec(trimmed);
  if (isoMatch) {
    const [, y, m, d] = isoMatch;
    const year = Number(y);
    const month = Number(m);
    const day = Number(d);
    return isValidCivilDate(year, month, day)
      ? { ok: true, iso: toIso(year, month, day) }
      : { ok: false, code: "INVALID_DATE" };
  }

  // F2-AC4: every XX-YY-ZZZZ value is DD-MM per the template, including when
  // both parts are <=12 and could be read either way — never guessed, always
  // DD-MM.
  const ddMmMatch = DD_MM_PATTERN.exec(trimmed);
  if (ddMmMatch) {
    const [, d, m, y] = ddMmMatch;
    const day = Number(d);
    const month = Number(m);
    const year = Number(y);
    return isValidCivilDate(year, month, day)
      ? { ok: true, iso: toIso(year, month, day) }
      : { ok: false, code: "INVALID_DATE" };
  }

  if (SERIAL_PATTERN.test(trimmed)) {
    return fromSerial(Number(trimmed));
  }

  return { ok: false, code: "INVALID_DATE" };
}

export function parseDateCell(raw: string | number | Date): DateParseResult {
  if (raw instanceof Date) {
    // exceljs already resolved this to calendar components internally — read
    // them back via UTC getters only, never local getters, or the value
    // shifts a day near local-midnight (timezone pitfall).
    return { ok: true, iso: toIso(raw.getUTCFullYear(), raw.getUTCMonth() + 1, raw.getUTCDate()) };
  }
  if (typeof raw === "number") return fromSerial(raw);
  return fromString(raw);
}
