import { describe, expect, it } from "vitest";

import type { WeekAggregate } from "./aggregate";
import { buildTemplateMemo } from "./template";

// T32 · F9 deterministic template memo — pure function, no DB required.

function fixture(overrides: Partial<WeekAggregate> = {}): WeekAggregate {
  return {
    period: { start: "2026-07-04", end: "2026-07-10" },
    runs: 3,
    recommendationsByPlay: {
      BUY_NOW: 2,
      WAIT: 5,
      PARTIAL_BUY: 0,
      HEDGE_LOCK: 0,
      SPLIT_SUPPLIERS: 1,
    },
    decisions: { APPROVE: 4, OVERRIDE: 1, REJECT: 0 },
    valueInr: 1_830_000,
    alerts: {
      byType: { COVER_BREACH: 1, CONC_BREACH: 0, BAND_WIDENING: 0, PRICE_SPIKE: 0 },
      bySeverity: { INFO: 0, WARN: 0, CRITICAL: 1 },
    },
    forecastQuality: {
      wape: [
        { materialCode: "WR-5.5-HC", plantCode: "RNC", model: "lightgbm", backtestWape: 0.135 },
        { materialCode: "WR-8-MS", plantCode: "HSP", model: "ets", backtestWape: 0.31 },
      ],
      coverage: [
        { gradeFamily: "WR-STD", coverage8090: 0.83 },
        { gradeFamily: "WR-LRPC", coverage8090: 0.55 },
      ],
    },
    ...overrides,
  };
}

describe("buildTemplateMemo (T32)", () => {
  it("is deterministic: same input produces the same output", () => {
    const input = fixture();
    expect(buildTemplateMemo(input)).toStrictEqual(buildTemplateMemo(input));
  });

  it("respects the PRD F9 output-contract limits", () => {
    const memo = buildTemplateMemo(fixture());
    expect(memo.headline.length).toBeLessThanOrEqual(120);
    expect(memo.summaryMd.length).toBeLessThanOrEqual(2500);
    expect(memo.keyNumbers.length).toBeLessThanOrEqual(6);
    expect(memo.risks.length).toBeLessThanOrEqual(4);
  });

  it("respects limits even under pathologically large counts", () => {
    const memo = buildTemplateMemo(
      fixture({
        runs: 999_999,
        recommendationsByPlay: {
          BUY_NOW: 123_456,
          WAIT: 123_456,
          PARTIAL_BUY: 123_456,
          HEDGE_LOCK: 123_456,
          SPLIT_SUPPLIERS: 123_456,
        },
        valueInr: 999_999_999_999,
      }),
    );
    expect(memo.headline.length).toBeLessThanOrEqual(120);
    expect(memo.summaryMd.length).toBeLessThanOrEqual(2500);
  });

  it("surfaces CRITICAL alerts, rejections, off-target coverage and WAPE as risks", () => {
    const memo = buildTemplateMemo(fixture());
    expect(memo.risks.some((r) => r.includes("critical alert"))).toBe(true);
    expect(memo.risks.some((r) => r.includes("price-band coverage"))).toBe(true);
    expect(memo.risks.some((r) => r.includes("WAPE target"))).toBe(true);
  });

  it("has zero risks and n/a WAPE when nothing is off-target", () => {
    const memo = buildTemplateMemo(
      fixture({
        decisions: { APPROVE: 1, OVERRIDE: 0, REJECT: 0 },
        alerts: {
          byType: { COVER_BREACH: 0, CONC_BREACH: 0, BAND_WIDENING: 0, PRICE_SPIKE: 0 },
          bySeverity: { INFO: 0, WARN: 0, CRITICAL: 0 },
        },
        forecastQuality: { wape: [], coverage: [] },
      }),
    );
    expect(memo.risks).toEqual([]);
    expect(memo.keyNumbers.find((k) => k.label === "Avg demand WAPE")?.value).toBe("n/a");
  });

  it("includes all six key numbers with the documented labels", () => {
    const memo = buildTemplateMemo(fixture());
    expect(memo.keyNumbers.map((k) => k.label)).toEqual([
      "Runs",
      "Recommendations",
      "Decisions",
      "Value",
      "Alerts",
      "Avg demand WAPE",
    ]);
  });
});
