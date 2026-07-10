import { afterAll, describe, expect, it } from "vitest";

import { getSql } from "@/db/client";

import { computeValueReport } from "./value";

// Integration tests for T30 (F8-AC1/AC2, F8-ERR2, OVERRIDDEN handling) against the live
// compose Postgres. Every fixture uses an isolated future year (2030+) for market_prices
// so assertions don't depend on — or drift with — the seeded FIX-2 dataset.

const sql = getSql();

async function seededId(table: "materials" | "plants" | "suppliers", code: string): Promise<string> {
  const [row] = await sql`select id from ${sql(table)} where code = ${code}`;
  return row.id as string;
}

async function seededUserId(email: string): Promise<string> {
  const [row] = await sql`select id from users where email = ${email}`;
  return row.id as string;
}

async function insertRun(): Promise<string> {
  const [row] = await sql`insert into runs (status) values ('DONE') returning id`;
  return row.id as string;
}

async function insertRecommendation(params: {
  runId: string;
  materialCode: string;
  plantCode: string;
  play: string;
  status: "APPROVED" | "OVERRIDDEN" | "REJECTED";
  orderLines: unknown[];
}): Promise<string> {
  const materialId = await seededId("materials", params.materialCode);
  const plantId = await seededId("plants", params.plantCode);
  const [row] = await sql`
    insert into recommendations (run_id, material_id, plant_id, play, status, order_lines)
    values (
      ${params.runId}, ${materialId}, ${plantId}, ${params.play}, ${params.status},
      ${JSON.stringify(params.orderLines)}::jsonb
    )
    returning id
  `;
  return row.id as string;
}

async function insertDecision(params: {
  recommendationId: string;
  action: "APPROVE" | "OVERRIDE" | "REJECT";
  decidedBy: string;
  decidedAt: string;
  override?: unknown;
  idempotencyKey: string;
}): Promise<void> {
  const overrideJson = params.override ? JSON.stringify(params.override) : null;
  await sql`
    insert into decision_records (recommendation_id, action, note, override, decided_by, decided_at, idempotency_key)
    values (
      ${params.recommendationId}, ${params.action}, 'test note here', ${overrideJson}::jsonb,
      ${params.decidedBy}, ${params.decidedAt}::timestamptz, ${params.idempotencyKey}
    )
  `;
}

async function insertBatch(uploadedBy: string): Promise<string> {
  const [row] = await sql`
    insert into upload_batches (type, filename, status, uploaded_by)
    values ('market_prices', 'test-fixture.csv', 'COMMITTED', ${uploadedBy})
    returning id
  `;
  return row.id as string;
}

async function insertMarketPrices(
  batchId: string,
  gradeFamily: string,
  points: { date: string; price: number }[],
): Promise<void> {
  for (const p of points) {
    await sql`
      insert into market_prices (date, source, grade_family, price_inr_mt, upload_batch_id)
      values (${p.date}, 'TEST_T30', ${gradeFamily}, ${p.price}, ${batchId})
    `;
  }
}

async function insertPurchaseOrder(params: {
  batchId: string;
  supplierCode: string;
  materialCode: string;
  plantCode: string;
  deliveryDate: string;
  unitPriceInr: number;
  poNumber: string;
}): Promise<void> {
  const supplierId = await seededId("suppliers", params.supplierCode);
  const materialId = await seededId("materials", params.materialCode);
  const plantId = await seededId("plants", params.plantCode);
  await sql`
    insert into purchase_orders (po_number, po_date, supplier_id, material_id, plant_id, qty_mt, unit_price_inr, delivery_date, upload_batch_id)
    values (${params.poNumber}, ${params.deliveryDate}, ${supplierId}, ${materialId}, ${plantId}, 100, ${params.unitPriceInr}, ${params.deliveryDate}, ${params.batchId})
  `;
}

async function cleanup(runIds: string[], batchIds: string[]): Promise<void> {
  for (const runId of runIds) {
    await sql`delete from decision_records where recommendation_id in (select id from recommendations where run_id = ${runId})`;
    await sql`delete from recommendations where run_id = ${runId}`;
    await sql`delete from runs where id = ${runId}`;
  }
  for (const batchId of batchIds) {
    await sql`delete from purchase_orders where upload_batch_id = ${batchId}`;
    await sql`delete from market_prices where upload_batch_id = ${batchId}`;
    await sql`delete from upload_batches where id = ${batchId}`;
  }
}

afterAll(async () => {
  await sql.end();
});

describe("computeValueReport (T30)", () => {
  it("F8-AC1: baseline = decision-month average market price x qty; value = baseline - plan cost", async () => {
    const buyer = await seededUserId("buyer@pdi.test");
    const batchId = await insertBatch(buyer);
    const runId = await insertRun();
    try {
      // Controlled month: avg(53000, 55000) = 54000 exactly.
      await insertMarketPrices(batchId, "WR-STD", [
        { date: "2030-01-05", price: 53000 },
        { date: "2030-01-20", price: 55000 },
      ]);
      const recId = await insertRecommendation({
        runId,
        materialCode: "WR-5.5-HC",
        plantCode: "RNC",
        play: "BUY_NOW",
        status: "APPROVED",
        orderLines: [
          { supplierCode: "TATA_LP", qtyMt: 100, targetWeek: "2030-01-13", estPriceInrMt: 54200 },
        ],
      });
      await insertDecision({
        recommendationId: recId,
        action: "APPROVE",
        decidedBy: buyer,
        decidedAt: "2030-01-15T10:00:00Z",
        idempotencyKey: "t30-baseline",
      });

      const report = await computeValueReport();
      const row = report.decisions.find((d) => d.recommendationId === recId);

      expect(row).toBeDefined();
      expect(row).toMatchObject({
        materialCode: "WR-5.5-HC",
        plantCode: "RNC",
        systemPlay: "BUY_NOW",
        humanAction: "APPROVE",
        overridePlay: null,
        qtyMt: 100,
        baselineInrMt: 54000,
        baselineCostInr: 5_400_000,
        planCostInr: 5_420_000,
        valueInr: -20_000,
        state: "ESTIMATED",
      });
    } finally {
      await cleanup([runId], [batchId]);
    }
  });

  it("F8-ERR2: no committed market prices in the decision month -> BASELINE_UNAVAILABLE, excluded from cumulative", async () => {
    const buyer = await seededUserId("buyer@pdi.test");
    const runId = await insertRun();
    try {
      const recId = await insertRecommendation({
        runId,
        materialCode: "WR-5.5-HC",
        plantCode: "RNC",
        play: "BUY_NOW",
        status: "APPROVED",
        orderLines: [
          { supplierCode: "TATA_LP", qtyMt: 50, targetWeek: "2031-06-09", estPriceInrMt: 54000 },
        ],
      });
      await insertDecision({
        recommendationId: recId,
        action: "APPROVE",
        decidedBy: buyer,
        decidedAt: "2031-06-15T10:00:00Z", // no WR-STD prices exist for this month
        idempotencyKey: "t30-baseline-unavailable",
      });

      const report = await computeValueReport();
      const row = report.decisions.find((d) => d.recommendationId === recId);

      expect(row).toMatchObject({
        state: "BASELINE_UNAVAILABLE",
        baselineInrMt: null,
        baselineCostInr: null,
        valueInr: null,
        planCostInr: 2_700_000, // still shown: 50 * 54000
      });
      expect(report.cumulative.some((c) => c.decidedAt === row!.decidedAt)).toBe(false);
    } finally {
      await cleanup([runId], []);
    }
  });

  it("OVERRIDDEN to a different play (BUY_NOW -> WAIT): qty/value forced to 0, never fabricated", async () => {
    const buyer = await seededUserId("buyer@pdi.test");
    const runId = await insertRun();
    try {
      const recId = await insertRecommendation({
        runId,
        materialCode: "WR-8-MS",
        plantCode: "HSP",
        play: "BUY_NOW",
        status: "OVERRIDDEN",
        orderLines: [
          { supplierCode: "JSW", qtyMt: 200, targetWeek: "2032-02-10", estPriceInrMt: 54500 },
        ],
      });
      await insertDecision({
        recommendationId: recId,
        action: "OVERRIDE",
        decidedBy: buyer,
        decidedAt: "2032-02-05T10:00:00Z",
        override: { play: "WAIT" },
        idempotencyKey: "t30-override-wait",
      });

      const report = await computeValueReport();
      const row = report.decisions.find((d) => d.recommendationId === recId);

      expect(row).toMatchObject({
        systemPlay: "BUY_NOW",
        humanAction: "OVERRIDE",
        overridePlay: "WAIT",
        qtyMt: 0,
        baselineInrMt: null,
        baselineCostInr: 0,
        planCostInr: 0,
        valueInr: 0,
        state: "ESTIMATED",
      });
    } finally {
      await cleanup([runId], []);
    }
  });

  it("F8-AC2: a matching actual PO within +/-1 week flips the row to ACTUALIZED and recomputes value", async () => {
    const buyer = await seededUserId("buyer@pdi.test");
    const batchId = await insertBatch(buyer);
    const runId = await insertRun();
    try {
      await insertMarketPrices(batchId, "WR-STD", [{ date: "2033-04-10", price: 54000 }]);
      const recId = await insertRecommendation({
        runId,
        materialCode: "WR-5.5-HC",
        plantCode: "RNC",
        play: "BUY_NOW",
        status: "APPROVED",
        orderLines: [
          { supplierCode: "TATA_LP", qtyMt: 10, targetWeek: "2033-04-13", estPriceInrMt: 54200 },
        ],
      });
      await insertDecision({
        recommendationId: recId,
        action: "APPROVE",
        decidedBy: buyer,
        decidedAt: "2033-04-15T10:00:00Z",
        idempotencyKey: "t30-actualize",
      });
      // Actual PO within the +/-7 day window of targetWeek 2033-04-13, distinct actual price.
      await insertPurchaseOrder({
        batchId,
        supplierCode: "TATA_LP",
        materialCode: "WR-5.5-HC",
        plantCode: "RNC",
        deliveryDate: "2033-04-15",
        unitPriceInr: 53900,
        poNumber: "T30-PO-1",
      });

      const report = await computeValueReport();
      const row = report.decisions.find((d) => d.recommendationId === recId);

      expect(row).toMatchObject({
        state: "ACTUALIZED",
        planCostInr: 539_000, // 10 * 53900 actual, not the 54200 estimate
        baselineCostInr: 540_000,
        valueInr: 1_000,
      });
    } finally {
      await cleanup([runId], [batchId]);
    }
  });

  it("cumulative series is ordered by decidedAt and running-sums valueInr", async () => {
    const buyer = await seededUserId("buyer@pdi.test");
    const batchId = await insertBatch(buyer);
    const runId = await insertRun();
    try {
      await insertMarketPrices(batchId, "WR-STD", [{ date: "2034-05-01", price: 54000 }]);
      // Insert the LATER decision first so ordering can't be an artifact of insert order.
      const laterId = await insertRecommendation({
        runId,
        materialCode: "WR-5.5-HC",
        plantCode: "RNC",
        play: "BUY_NOW",
        status: "APPROVED",
        orderLines: [
          { supplierCode: "TATA_LP", qtyMt: 10, targetWeek: "2034-05-20", estPriceInrMt: 54000 },
        ],
      });
      await insertDecision({
        recommendationId: laterId,
        action: "APPROVE",
        decidedBy: buyer,
        decidedAt: "2034-05-20T10:00:00Z",
        idempotencyKey: "t30-cumulative-later",
      });
      const earlierId = await insertRecommendation({
        runId,
        materialCode: "WR-5.5-HC",
        plantCode: "RNC",
        play: "BUY_NOW",
        status: "APPROVED",
        orderLines: [
          { supplierCode: "TATA_LP", qtyMt: 10, targetWeek: "2034-05-05", estPriceInrMt: 53000 },
        ],
      });
      await insertDecision({
        recommendationId: earlierId,
        action: "APPROVE",
        decidedBy: buyer,
        decidedAt: "2034-05-05T10:00:00Z",
        idempotencyKey: "t30-cumulative-earlier",
      });

      const report = await computeValueReport();
      // The live DB accumulates decisions across the whole test suite/session, so assert
      // ordering + per-row deltas rather than an absolute running total.
      const isSorted = report.cumulative.every(
        (c, i) => i === 0 || new Date(c.decidedAt) >= new Date(report.cumulative[i - 1].decidedAt),
      );
      expect(isSorted).toBe(true);

      const earlierIdx = report.cumulative.findIndex(
        (c) => c.decidedAt === new Date("2034-05-05T10:00:00Z").toISOString(),
      );
      const laterIdx = report.cumulative.findIndex(
        (c) => c.decidedAt === new Date("2034-05-20T10:00:00Z").toISOString(),
      );

      expect(earlierIdx).toBeGreaterThanOrEqual(0);
      expect(laterIdx).toBeGreaterThan(earlierIdx);
      // earlier: baseline 540000 - plan 530000 = +10000; later: baseline 540000 - plan 540000 = 0
      const earlierDelta =
        report.cumulative[earlierIdx].cumulativeValueInr -
        (earlierIdx > 0 ? report.cumulative[earlierIdx - 1].cumulativeValueInr : 0);
      const laterDelta =
        report.cumulative[laterIdx].cumulativeValueInr -
        report.cumulative[laterIdx - 1].cumulativeValueInr;
      expect(earlierDelta).toBe(10_000);
      expect(laterDelta).toBe(0);
    } finally {
      await cleanup([runId], [batchId]);
    }
  });

  it("summary reports totalValueInr, decidedCount and adoptionPct as a percentage in [0, 100]", async () => {
    const report = await computeValueReport();
    expect(typeof report.summary.totalValueInr).toBe("number");
    expect(report.summary.decidedCount).toBeGreaterThanOrEqual(0);
    expect(report.summary.adoptionPct).toBeGreaterThanOrEqual(0);
    expect(report.summary.adoptionPct).toBeLessThanOrEqual(100);
  });
});
