import { describe, expect, it } from "vitest";

import { formatSeriesKey, parseSeriesParam, seriesEquals } from "./series";

describe("formatSeriesKey", () => {
  it("joins material and plant codes with a colon", () => {
    expect(formatSeriesKey({ materialCode: "WR-5.5-HC", plantCode: "RNC" })).toBe(
      "WR-5.5-HC:RNC",
    );
  });
});

describe("parseSeriesParam", () => {
  it("parses a well-formed series param", () => {
    expect(parseSeriesParam("WR-5.5-HC:RNC")).toEqual({
      materialCode: "WR-5.5-HC",
      plantCode: "RNC",
    });
  });

  it("returns null for undefined input", () => {
    expect(parseSeriesParam(undefined)).toBeNull();
  });

  it("returns null for empty string", () => {
    expect(parseSeriesParam("")).toBeNull();
  });

  it("returns null when there is no colon", () => {
    expect(parseSeriesParam("WR-5.5-HC")).toBeNull();
  });

  it("returns null when there are extra colons", () => {
    expect(parseSeriesParam("WR-5.5-HC:RNC:extra")).toBeNull();
  });

  it("returns null when either side is empty", () => {
    expect(parseSeriesParam(":RNC")).toBeNull();
    expect(parseSeriesParam("WR-5.5-HC:")).toBeNull();
  });
});

describe("seriesEquals", () => {
  it("is true for matching material and plant codes", () => {
    expect(
      seriesEquals(
        { materialCode: "WR-5.5-HC", plantCode: "RNC" },
        { materialCode: "WR-5.5-HC", plantCode: "RNC" },
      ),
    ).toBe(true);
  });

  it("is false when either code differs", () => {
    expect(
      seriesEquals(
        { materialCode: "WR-5.5-HC", plantCode: "RNC" },
        { materialCode: "WR-5.5-HC", plantCode: "OTHER" },
      ),
    ).toBe(false);
  });
});
