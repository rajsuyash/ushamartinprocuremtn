import { afterAll, describe, expect, it } from "vitest";

import { getSql } from "@/db/client";

import { buildWeekAggregate, computeWeekPeriod, scrubForbiddenFields } from "./aggregate";

// T32 · F9 week-aggregate assembly against the live compose Postgres. Vitest runs
// test files in parallel workers against the same DB (routes.test.ts, value.test.ts,
// etc. insert/delete "now"-dated recommendations/decisions/alerts concurrently), so
// asserting an absolute total over a "now"-anchored period is racy by construction.
// Following value.test.ts's precedent (isolated future years for F8 fixtures), the
// correctness test below anchors its period on an isolated historical date
// (2022-03, touched by no other fixture in this repo) that nothing else can
// contaminate, so exact counts are asserted deterministically.

const sql = getSql();

async function seededId(table: "materials" | "plants" | "users", code: string): Promise<string> {
  const column = table === "users" ? "email" : "code";
  const [row] = await sql`select id from ${sql(table)} where ${sql(column)} = ${code}`;
  return row.id as string;
}

afterAll(async () => {
  await sql.end();
});

describe("computeWeekPeriod (T32)", () => {
  it("returns a 7-day inclusive window ending on the given business date (UTC)", () => {
    expect(computeWeekPeriod(new Date("2026-07-10T15:30:00Z"))).toEqual({
      start: "2026-07-04",
      end: "2026-07-10",
    });
  });
});

describe("scrubForbiddenFields (T32)", () => {
  it("passes a clean, aggregate-shaped object", () => {
    expect(() =>
      scrubForbiddenFields({
        period: { start: "2026-07-04", end: "2026-07-10" },
        runs: 3,
        recommendationsByPlay: { BUY_NOW: 1 },
        decisions: { APPROVE: 1, OVERRIDE: 0, REJECT: 0 },
        valueInr: 1000,
        alerts: { byType: { COVER_BREACH: 1 }, bySeverity: { CRITICAL: 1 } },
        forecastQuality: {
          wape: [
            { materialCode: "WR-5.5-HC", plantCode: "RNC", model: "lightgbm", backtestWape: 0.1 },
          ],
          coverage: [{ gradeFamily: "WR-STD", coverage8090: 0.8 }],
        },
      }),
    ).not.toThrow();
  });

  it("throws when an object smuggles a decision note under a `note` key", () => {
    expect(() =>
      scrubForbiddenFields({ decisions: { note: "buyer overrode because the mill offered a discount" } }),
    ).toThrow(/FORBIDDEN_FIELD/);
  });

  it("throws when a string value contains an email address", () => {
    expect(() => scrubForbiddenFields({ sneaky: "buyer@pdi.test" })).toThrow(/FORBIDDEN_FIELD/);
  });

  it("throws when a key smuggles a supplier contract term", () => {
    expect(() => scrubForbiddenFields({ contractTerms: "net 30, FOB plant" })).toThrow(
      /FORBIDDEN_FIELD/,
    );
  });

  it("throws when a string value matches a live environment variable's value", () => {
    process.env.T32_TEST_SECRET = "super-secret-value-xyz";
    try {
      expect(() => scrubForbiddenFields({ value: "super-secret-value-xyz" })).toThrow(
        /FORBIDDEN_FIELD/,
      );
    } finally {
      delete process.env.T32_TEST_SECRET;
    }
  });

  it("catches a forbidden field nested inside an array", () => {
    expect(() => scrubForbiddenFields([{ ok: true }, { userEmail: "hidden@pdi.test" }])).toThrow(
      /FORBIDDEN_FIELD/,
    );
  });
});

describe("buildWeekAggregate (T32)", () => {
  it("counts match a hand-built fixture in an isolated (2022-03) period — F3/F5/F6/F7 sources agree", async () => {
    const materialId = await seededId("materials", "WR-5.5-HC");
    const plantId = await seededId("plants", "RNC");
    const buyerId = await seededId("users", "buyer@pdi.test");

    const [runRow] = await sql`
      insert into runs (status, created_at) values ('DONE', '2022-03-10T09:00:00Z') returning id
    `;
    const runId = runRow.id as string;

    try {
      const [approvedRec] = await sql`
        insert into recommendations (run_id, material_id, plant_id, play, status, order_lines, created_at)
        values (${runId}, ${materialId}, ${plantId}, 'BUY_NOW', 'APPROVED', '[]'::jsonb, '2022-03-11T10:00:00Z')
        returning id
      `;
      await sql`
        insert into recommendations (run_id, material_id, plant_id, play, status, order_lines, created_at)
        values (${runId}, ${materialId}, ${plantId}, 'WAIT', 'PENDING', '[]'::jsonb, '2022-03-12T10:00:00Z')
      `;
      await sql`
        insert into decision_records (recommendation_id, action, note, decided_by, decided_at, idempotency_key)
        values (${approvedRec.id}, 'APPROVE', 'fixture note', ${buyerId}, '2022-03-13T10:00:00Z', 'T32-fixture-decision')
      `;
      await sql`
        insert into alerts (run_id, type, severity, created_at)
        values (${runId}, 'COVER_BREACH', 'CRITICAL', '2022-03-09T10:00:00Z')
      `;

      const aggregate = await buildWeekAggregate(new Date("2022-03-15T12:00:00Z"));

      expect(aggregate.period).toEqual({ start: "2022-03-09", end: "2022-03-15" });
      expect(aggregate.runs).toBe(1);
      expect(aggregate.recommendationsByPlay).toEqual({
        BUY_NOW: 1,
        WAIT: 1,
        PARTIAL_BUY: 0,
        HEDGE_LOCK: 0,
        SPLIT_SUPPLIERS: 0,
      });
      expect(aggregate.decisions).toEqual({ APPROVE: 1, OVERRIDE: 0, REJECT: 0 });
      expect(aggregate.alerts.byType).toEqual({
        COVER_BREACH: 1,
        CONC_BREACH: 0,
        BAND_WIDENING: 0,
        PRICE_SPIKE: 0,
      });
      expect(aggregate.alerts.bySeverity).toEqual({ INFO: 0, WARN: 0, CRITICAL: 1 });
      // No market_prices exist for March 2022 -> BASELINE_UNAVAILABLE -> excluded, not zeroed-and-hidden.
      expect(aggregate.valueInr).toBe(0);
    } finally {
      await sql`delete from decision_records where recommendation_id in (select id from recommendations where run_id = ${runId})`;
      await sql`delete from recommendations where run_id = ${runId}`;
      await sql`delete from alerts where run_id = ${runId}`;
      await sql`delete from runs where id = ${runId}`;
    }
  });

  it("zero-fills every enum key when nothing falls inside the period", async () => {
    const aggregate = await buildWeekAggregate(new Date("2019-01-01T00:00:00Z"));

    expect(aggregate.runs).toBe(0);
    expect(aggregate.recommendationsByPlay).toEqual({
      BUY_NOW: 0,
      WAIT: 0,
      PARTIAL_BUY: 0,
      HEDGE_LOCK: 0,
      SPLIT_SUPPLIERS: 0,
    });
    expect(aggregate.decisions).toEqual({ APPROVE: 0, OVERRIDE: 0, REJECT: 0 });
    expect(aggregate.valueInr).toBe(0);
    expect(aggregate.alerts.byType).toEqual({
      COVER_BREACH: 0,
      CONC_BREACH: 0,
      BAND_WIDENING: 0,
      PRICE_SPIKE: 0,
    });
  });

  it("the assembled aggregate itself passes the forbidden-field scrub", async () => {
    const aggregate = await buildWeekAggregate();
    expect(() => scrubForbiddenFields(aggregate)).not.toThrow();
  });
});
