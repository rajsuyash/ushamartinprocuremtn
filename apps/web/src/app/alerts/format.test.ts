import { describe, expect, it } from "vitest";

import { severityChipClass, summarizeAlertPayload } from "./format";

describe("summarizeAlertPayload", () => {
  it("COVER_BREACH: cover days vs floor", () => {
    expect(
      summarizeAlertPayload("COVER_BREACH", { coverDays: 16.6, minCoverDays: 21 }),
    ).toBe("16.6d vs 21d floor");
  });

  it("CONC_BREACH: supplier share vs cap", () => {
    expect(
      summarizeAlertPayload("CONC_BREACH", {
        supplierCode: "TATA_LP",
        sharePct: 66.7,
        capPct: 60,
      }),
    ).toBe("TATA_LP 66.7% > 60%");
  });

  it("BAND_WIDENING: grade family spread at horizon", () => {
    expect(
      summarizeAlertPayload("BAND_WIDENING", {
        gradeFamily: "WR-STD",
        spreadPct: 9.2,
        horizonWeeks: 4,
      }),
    ).toBe("WR-STD band 9.2% at 4w");
  });

  it("PRICE_SPIKE: grade family w/w move, sign shown for both directions", () => {
    expect(
      summarizeAlertPayload("PRICE_SPIKE", { gradeFamily: "WR-STD", wowMovePct: 3.5 }),
    ).toBe("WR-STD +3.5% w/w");
    expect(
      summarizeAlertPayload("PRICE_SPIKE", { gradeFamily: "WR-STD", wowMovePct: -4.1 }),
    ).toBe("WR-STD -4.1% w/w");
  });

  it("falls back to a generic message for an unrecognized type", () => {
    expect(summarizeAlertPayload("UNKNOWN", {})).toBe("See detail");
  });
});

describe("severityChipClass", () => {
  it("maps CRITICAL/WARN/INFO to distinct classes", () => {
    expect(severityChipClass("CRITICAL")).toContain("red");
    expect(severityChipClass("WARN")).toContain("amber");
    expect(severityChipClass("INFO")).toContain("gray");
  });

  it("falls back to a neutral class for an unrecognized severity", () => {
    expect(severityChipClass("WEIRD")).toBe("bg-gray-100 text-gray-600");
  });
});
