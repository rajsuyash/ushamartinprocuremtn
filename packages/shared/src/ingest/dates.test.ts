import { describe, expect, it } from "vitest";
import { parseDateCell } from "./dates";

describe("parseDateCell — F2-AC4 matrix", () => {
  it("parses YYYY-MM-DD", () => {
    expect(parseDateCell("2026-03-15")).toEqual({ ok: true, iso: "2026-03-15" });
  });

  it("parses DD-MM-YYYY to the same DATE as the ISO form", () => {
    expect(parseDateCell("15-03-2026")).toEqual({ ok: true, iso: "2026-03-15" });
  });

  it("parses the equivalent Excel serial number to the same DATE", () => {
    // Verified against 1899-12-30 epoch day arithmetic: serial 46096 == 2026-03-15.
    expect(parseDateCell(46096)).toEqual({ ok: true, iso: "2026-03-15" });
    expect(parseDateCell("46096")).toEqual({ ok: true, iso: "2026-03-15" });
  });

  it("resolves an ambiguous XX-YY-YYYY (both <=12) as DD-MM, never guessed", () => {
    // 05-03-2026 must mean day=5, month=3 (5 March), not month=5, day=3.
    expect(parseDateCell("05-03-2026")).toEqual({ ok: true, iso: "2026-03-05" });
  });

  it("accepts a real leap day", () => {
    expect(parseDateCell("29-02-2024")).toEqual({ ok: true, iso: "2024-02-29" });
    expect(parseDateCell(45351)).toEqual({ ok: true, iso: "2024-02-29" });
  });

  it("rejects a leap day on a non-leap year as INVALID_DATE", () => {
    expect(parseDateCell("29-02-2023")).toEqual({ ok: false, code: "INVALID_DATE" });
  });

  it("rejects an impossible month", () => {
    expect(parseDateCell("15-13-2026")).toEqual({ ok: false, code: "INVALID_DATE" });
  });

  it("rejects an impossible day-of-month", () => {
    expect(parseDateCell("31-04-2026")).toEqual({ ok: false, code: "INVALID_DATE" });
  });

  it("rejects unparseable text", () => {
    expect(parseDateCell("not-a-date")).toEqual({ ok: false, code: "INVALID_DATE" });
  });

  it("reads a native Date (exceljs-resolved cell) via UTC components only", () => {
    expect(parseDateCell(new Date(Date.UTC(2026, 2, 15)))).toEqual({ ok: true, iso: "2026-03-15" });
  });
});
