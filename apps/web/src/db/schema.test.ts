import { randomUUID } from "node:crypto";

import type { TransactionSql } from "postgres";
import { afterAll, describe, expect, it } from "vitest";

import { getSql } from "./client";

// Hostile-reviewer suite for the PRD §7 invariants. Every test runs inside a
// transaction that ALWAYS rolls back, so the shared dev DB is left pristine — the
// violating statement is attempted inside a savepoint so its failure does not abort
// the outer transaction, letting us both assert the rejection and clean up for free.
//
// Requires DATABASE_URL pointing at the live compose postgres (localhost:5442).

const ROLLBACK = Symbol("rollback");

/** Runs fn in a transaction, captures its return, then force-rolls-back everything. */
async function inRollbackTx<T>(fn: (tx: TransactionSql) => Promise<T>): Promise<T> {
  const sql = getSql();
  let result!: T;
  try {
    await sql.begin(async (tx: TransactionSql) => {
      result = await fn(tx);
      throw ROLLBACK;
    });
  } catch (e) {
    if (e !== ROLLBACK) throw e;
  }
  return result;
}

/** Attempts a violating statement in a savepoint; returns the DB error (or null if it unexpectedly succeeded). */
async function attempt(
  tx: TransactionSql,
  violate: (sp: TransactionSql) => Promise<unknown>,
): Promise<{ code?: string; constraint_name?: string } | null> {
  try {
    await tx.savepoint(async (sp: TransactionSql) => {
      await violate(sp);
    });
    return null;
  } catch (e) {
    return e as { code?: string; constraint_name?: string };
  }
}

const rnd = () => randomUUID().slice(0, 8);

async function seedUser(tx: TransactionSql): Promise<string> {
  const [row] = await tx`
    insert into users (email, password_hash, role)
    values (${`u_${rnd()}@pdi.test`}, 'x', 'buyer') returning id`;
  return row.id;
}

async function seedPlant(tx: TransactionSql): Promise<string> {
  const [row] = await tx`
    insert into plants (code, name) values (${`P_${rnd()}`}, 'Plant') returning id`;
  return row.id;
}

async function seedMaterial(tx: TransactionSql): Promise<string> {
  const [row] = await tx`
    insert into materials (code, description, grade_family)
    values (${`M_${rnd()}`}, 'desc', 'HC') returning id`;
  return row.id;
}

async function seedSupplier(tx: TransactionSql): Promise<string> {
  const [row] = await tx`
    insert into suppliers (code, name, type, lead_time_days)
    values (${`S_${rnd()}`}, 'Sup', 'DOMESTIC', 7) returning id`;
  return row.id;
}

async function seedBatch(tx: TransactionSql, uploadedBy: string): Promise<string> {
  const [row] = await tx`
    insert into upload_batches (type, filename, uploaded_by)
    values ('purchase_orders', 'f.csv', ${uploadedBy}) returning id`;
  return row.id;
}

async function seedRun(tx: TransactionSql): Promise<string> {
  const [row] = await tx`insert into runs default values returning id`;
  return row.id;
}

async function seedRecommendation(
  tx: TransactionSql,
  runId: string,
  materialId: string,
  plantId: string,
): Promise<string> {
  const [row] = await tx`
    insert into recommendations (run_id, material_id, plant_id, play)
    values (${runId}, ${materialId}, ${plantId}, 'BUY_NOW') returning id`;
  return row.id;
}

describe("PRD §7 DB invariants (hostile set)", () => {
  afterAll(async () => {
    await getSql().end();
  });

  it("rejects a duplicate PO line — UNIQUE(po_number, material_id, delivery_date)", async () => {
    const err = await inRollbackTx(async (tx) => {
      const userId = await seedUser(tx);
      const plantId = await seedPlant(tx);
      const materialId = await seedMaterial(tx);
      const supplierId = await seedSupplier(tx);
      const batchId = await seedBatch(tx, userId);
      const poNumber = `PO_${rnd()}`;
      const insert = (sp: TransactionSql) => sp`
        insert into purchase_orders
          (po_number, po_date, supplier_id, material_id, plant_id, qty_mt, unit_price_inr, delivery_date, upload_batch_id)
        values (${poNumber}, '2026-01-01', ${supplierId}, ${materialId}, ${plantId}, 10.5, 50000, '2026-02-01', ${batchId})`;
      await insert(tx); // first line commits within the tx
      return attempt(tx, insert); // identical key → reject
    });
    expect(err).not.toBeNull();
    expect(err?.code).toBe("23505");
    expect(err?.constraint_name).toBe("purchase_orders_line_uq");
  });

  it("rejects a duplicate market price — UNIQUE(date, source, grade_family)", async () => {
    const err = await inRollbackTx(async (tx) => {
      const userId = await seedUser(tx);
      const batchId = await seedBatch(tx, userId);
      const insert = (sp: TransactionSql) => sp`
        insert into market_prices (date, source, grade_family, price_inr_mt, upload_batch_id)
        values ('2026-01-01', 'CRISIL', 'HC', 55000, ${batchId})`;
      await insert(tx);
      return attempt(tx, insert);
    });
    expect(err?.code).toBe("23505");
    expect(err?.constraint_name).toBe("market_prices_point_uq");
  });

  it("rejects a second DecisionRecord for the same recommendation_id — decide-once UNIQUE", async () => {
    const err = await inRollbackTx(async (tx) => {
      const userId = await seedUser(tx);
      const plantId = await seedPlant(tx);
      const materialId = await seedMaterial(tx);
      const runId = await seedRun(tx);
      const recId = await seedRecommendation(tx, runId, materialId, plantId);
      await tx`
        insert into decision_records (recommendation_id, action, note, decided_by, idempotency_key)
        values (${recId}, 'APPROVE', '', ${userId}, ${`k_${rnd()}`})`;
      return attempt(
        tx,
        (sp) => sp`
          insert into decision_records (recommendation_id, action, note, decided_by, idempotency_key)
          values (${recId}, 'REJECT', 'ten chars.', ${userId}, ${`k_${rnd()}`})`,
      );
    });
    expect(err?.code).toBe("23505");
    expect(err?.constraint_name).toBe(
      "decision_records_recommendation_id_unique",
    );
  });

  it("rejects a duplicate idempotency_key — retry-safe UNIQUE", async () => {
    const err = await inRollbackTx(async (tx) => {
      const userId = await seedUser(tx);
      const plantId = await seedPlant(tx);
      const materialId = await seedMaterial(tx);
      const runId = await seedRun(tx);
      const rec1 = await seedRecommendation(tx, runId, materialId, plantId);
      const rec2 = await seedRecommendation(tx, runId, materialId, plantId);
      const key = `k_${rnd()}`;
      await tx`
        insert into decision_records (recommendation_id, action, note, decided_by, idempotency_key)
        values (${rec1}, 'APPROVE', '', ${userId}, ${key})`;
      return attempt(
        tx,
        (sp) => sp`
          insert into decision_records (recommendation_id, action, note, decided_by, idempotency_key)
          values (${rec2}, 'APPROVE', '', ${userId}, ${key})`,
      );
    });
    expect(err?.code).toBe("23505");
    expect(err?.constraint_name).toBe("decision_records_idempotency_key_unique");
  });

  it("rejects a second active PolicyConfig while one is active — partial unique index", async () => {
    const err = await inRollbackTx(async (tx) => {
      const userId = await seedUser(tx);
      const insert = (sp: TransactionSql) => sp`
        insert into policy_configs
          (min_cover_days, target_cover_days, max_supplier_share_pct, service_level_pct, is_active, created_by)
        values (21, 30, 60.00, 95.00, true, ${userId})`;
      await insert(tx); // first active policy
      return attempt(tx, insert); // second active → reject
    });
    expect(err?.code).toBe("23505");
    expect(err?.constraint_name).toBe("policy_configs_one_active_idx");
  });

  it("rejects a price band where p10 > p50 — CHECK p10 <= p50 <= p90", async () => {
    const err = await inRollbackTx(async (tx) => {
      const runId = await seedRun(tx);
      return attempt(
        tx,
        (sp) => sp`
          insert into price_forecasts
            (run_id, grade_family, horizon_weeks, p10_inr_mt, p50_inr_mt, p90_inr_mt)
          values (${runId}, 'HC', 4, 60000, 50000, 70000)`,
      );
    });
    expect(err?.code).toBe("23514");
    expect(err?.constraint_name).toBe("price_forecasts_band_order");
  });

  it("rejects a negative quantity — CHECK qty_mt > 0", async () => {
    const err = await inRollbackTx(async (tx) => {
      const userId = await seedUser(tx);
      const plantId = await seedPlant(tx);
      const materialId = await seedMaterial(tx);
      const batchId = await seedBatch(tx, userId);
      return attempt(
        tx,
        (sp) => sp`
          insert into consumption_records (date, material_id, plant_id, qty_mt, upload_batch_id)
          values ('2026-01-01', ${materialId}, ${plantId}, -5.000, ${batchId})`,
      );
    });
    expect(err?.code).toBe("23514");
    expect(err?.constraint_name).toBe("consumption_records_qty_positive");
  });
});
