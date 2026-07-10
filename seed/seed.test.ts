import { createHash } from "node:crypto";

import bcrypt from "bcryptjs";
import type postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { makeSql } from "./db";
import { COVER_BREACH_DAYS } from "./fix3-tuning";
import { runSeed } from "./index";
import { TEST_USER_PASSWORD } from "./users";

// Requires DATABASE_URL pointing at the live compose postgres (localhost:5442).
// These tests reseed the shared dev DB — safe, because the seed is defined as a full
// wipe+reload and that is exactly what we are asserting.

let sql: postgres.Sql;

/** md5 over an ordered SELECT across every seeded table's *business* columns.
 * Deliberately excludes surrogate UUIDs and created_at so the hash reflects data
 * content, not per-run randomness — determinism must hold on those columns. */
async function contentHash(db: postgres.Sql): Promise<string> {
  const parts: unknown[] = [];
  parts.push(await db`select email, role from users order by email`);
  parts.push(await db`select code, name from plants order by code`);
  parts.push(await db`select code, description, grade_family from materials order by code`);
  parts.push(await db`select code, name, type, lead_time_days from suppliers order by code`);
  parts.push(
    await db`select min_cover_days, target_cover_days, max_supplier_share_pct, service_level_pct, wc_cap_inr, is_active
             from policy_configs order by created_at`,
  );
  parts.push(await db`select type, filename, status from upload_batches order by type`);
  parts.push(await db`select date, source, grade_family, price_inr_mt from market_prices order by grade_family, date`);
  parts.push(
    await db`select cr.date, m.code as mat, p.code as plant, cr.qty_mt
             from consumption_records cr
             join materials m on m.id = cr.material_id
             join plants p on p.id = cr.plant_id
             order by m.code, p.code, cr.date`,
  );
  parts.push(
    await db`select po.po_number, s.code as sup, m.code as mat, p.code as plant, po.qty_mt, po.unit_price_inr, po.po_date, po.delivery_date
             from purchase_orders po
             join suppliers s on s.id = po.supplier_id
             join materials m on m.id = po.material_id
             join plants p on p.id = po.plant_id
             order by po.po_number`,
  );
  parts.push(
    await db`select i.as_of_date, m.code as mat, p.code as plant, i.qty_mt
             from inventory_snapshots i
             join materials m on m.id = i.material_id
             join plants p on p.id = i.plant_id
             order by m.code, p.code`,
  );
  return createHash("md5").update(JSON.stringify(parts)).digest("hex");
}

async function coverDays(db: postgres.Sql, mat: string, plant: string): Promise<number> {
  const [inv] = await db`
    select i.qty_mt::float8 as qty from inventory_snapshots i
    join materials m on m.id = i.material_id join plants p on p.id = i.plant_id
    where m.code = ${mat} and p.code = ${plant}`;
  const trailing = await db`
    select cr.qty_mt::float8 as qty from consumption_records cr
    join materials m on m.id = cr.material_id join plants p on p.id = cr.plant_id
    where m.code = ${mat} and p.code = ${plant}
    order by cr.date desc limit 8`;
  const avgDaily = trailing.reduce((a, r) => a + (r.qty as number), 0) / trailing.length / 7;
  return (inv.qty as number) / avgDaily;
}

beforeAll(async () => {
  sql = makeSql();
});

afterAll(async () => {
  await sql.end();
});

describe("FIX-2 seed", () => {
  it("(a) is idempotent — two full runs produce the same content hash", async () => {
    await runSeed(sql);
    const h1 = await contentHash(sql);
    await runSeed(sql);
    const h2 = await contentHash(sql);
    expect(h2).toBe(h1);
  }, 60_000);

  it("(b) has the expected row counts", async () => {
    const [{ n: users }] = await sql`select count(*)::int as n from users`;
    const [{ n: plants }] = await sql`select count(*)::int as n from plants`;
    const [{ n: materials }] = await sql`select count(*)::int as n from materials`;
    const [{ n: suppliers }] = await sql`select count(*)::int as n from suppliers`;
    const [{ n: activePolicies }] = await sql`select count(*)::int as n from policy_configs where is_active = true`;
    expect(users).toBe(4);
    expect(plants).toBe(2);
    expect(materials).toBe(3);
    expect(suppliers).toBe(3);
    expect(activePolicies).toBe(1);

    // > 150 weekly price points per grade family.
    const perFamily = await sql`select grade_family, count(*)::int as n from market_prices group by grade_family`;
    expect(perFamily.length).toBe(2);
    for (const row of perFamily) expect(row.n as number).toBeGreaterThan(150);

    // ~36 months of weekly consumption per series (6 series × ~157 weeks).
    const [{ weeks }] = await sql`
      select count(distinct date)::int as weeks from consumption_records cr
      join materials m on m.id = cr.material_id where m.code = 'WR-5.5-HC'`;
    expect(weeks as number).toBeGreaterThanOrEqual(150);
    const [{ span }] = await sql`select (max(date) - min(date))::int as span from consumption_records`;
    expect(span as number).toBeGreaterThanOrEqual(1000); // ≥ ~33 months of days
  }, 30_000);

  it("(c) FIX-3: breach series ≈18.2d cover, WAIT series comfortable, WR-STD rising", async () => {
    const breach = await coverDays(sql, "WR-5.5-HC", "RNC");
    expect(breach).toBeGreaterThan(COVER_BREACH_DAYS - 0.3);
    expect(breach).toBeLessThan(COVER_BREACH_DAYS + 0.3);

    const wait = await coverDays(sql, "WR-8-MS", "HSP");
    expect(wait).toBeGreaterThanOrEqual(35);

    const last6 = await sql`
      select price_inr_mt::int as p from market_prices
      where grade_family = 'WR-STD' order by date desc limit 6`;
    const rising = last6.map((r) => r.p as number).reverse();
    expect(rising[rising.length - 1]).toBeGreaterThan(rising[0]); // positive 6-week trend
  }, 30_000);

  it("(d) FIX-1: bcrypt hash of the test password verifies for buyer@pdi.test", async () => {
    const [buyer] = await sql`select password_hash from users where email = 'buyer@pdi.test'`;
    const ok = await bcrypt.compare(TEST_USER_PASSWORD, buyer.password_hash as string);
    expect(ok).toBe(true);
  });
});
