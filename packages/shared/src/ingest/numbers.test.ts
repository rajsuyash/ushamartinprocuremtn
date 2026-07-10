import { describe, expect, it } from "vitest";
import { parseMoneyInteger, parseQtyDecimal } from "./numbers";

describe("parseQtyDecimal", () => {
  it("strips thousands separators before parsing", () => {
    expect(parseQtyDecimal("54,200")).toEqual({ ok: true, value: "54200.000" });
  });

  it("preserves 3dp on a decimal quantity", () => {
    expect(parseQtyDecimal("412.5")).toEqual({ ok: true, value: "412.500" });
  });

  it("accepts an already-numeric cell (XLSX)", () => {
    expect(parseQtyDecimal(412.5)).toEqual({ ok: true, value: "412.500" });
  });

  it("rejects a currency symbol with INVALID_NUMBER, never silent NaN", () => {
    expect(parseQtyDecimal("₹54,200")).toEqual({ ok: false, code: "INVALID_NUMBER" });
  });

  it("rejects garbage text with INVALID_NUMBER", () => {
    expect(parseQtyDecimal("abc")).toEqual({ ok: false, code: "INVALID_NUMBER" });
  });

  it("flags a negative quantity with NEGATIVE_QTY", () => {
    expect(parseQtyDecimal("-10")).toEqual({ ok: false, code: "NEGATIVE_QTY" });
  });
});

describe("parseMoneyInteger", () => {
  it("parses a clean integer INR amount", () => {
    expect(parseMoneyInteger("54200")).toEqual({ ok: true, value: 54200 });
  });

  it("strips thousands separators", () => {
    expect(parseMoneyInteger("1,54,200")).toEqual({ ok: true, value: 154200 });
  });

  it("flags a fractional price with NON_INTEGER_PRICE", () => {
    expect(parseMoneyInteger("54200.50")).toEqual({ ok: false, code: "NON_INTEGER_PRICE" });
  });

  it("rejects a currency symbol with INVALID_NUMBER", () => {
    expect(parseMoneyInteger("₹54200")).toEqual({ ok: false, code: "INVALID_NUMBER" });
  });

  it("accepts an already-numeric integer cell (XLSX)", () => {
    expect(parseMoneyInteger(54200)).toEqual({ ok: true, value: 54200 });
  });

  it("flags an already-numeric fractional cell (XLSX) with NON_INTEGER_PRICE", () => {
    expect(parseMoneyInteger(54200.5)).toEqual({ ok: false, code: "NON_INTEGER_PRICE" });
  });
});
