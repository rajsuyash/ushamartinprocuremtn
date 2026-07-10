import type postgres from "postgres";

import { makeRng, MASTER_SEED } from "./rng";
import {
  COMFORTABLE_COVER_DAYS,
  COVER_BREACH_DAYS,
  NEUTRAL_COVER_DAYS,
  TRAILING_WEEKS_FOR_COVER,
  WR_STD_END_MOMENTUM_PCT,
  WR_STD_MOMENTUM_WEEKS,
} from "./fix3-tuning";

// FIX-2 deterministic demo dataset. Everything below is a pure function of the
// master seed (42) plus the run's anchor date, so wipe+reload reproduces the exact
// same state (surrogate UUIDs aside — the idempotency test hashes business columns).
//
// Grain choice: consumption and market prices are stored as WEEKLY rows (Monday of
// each ISO week). Weekly is the simpler grain and is exactly what the cover formula
// and the price backtest consume; daily rows would be ~7× the volume for no gain.

const WEEKS = 157; // ~36 months of weekly points (157 × 7 = 1099 days ≈ 36.1 months)
const REORDER_WEEKS = 4; // replenishment cadence for PO history
const DAY_MS = 86_400_000;

// Sub-stream seeds (see rng.ts): independent so one generator's edits don't churn another.
const SEED_CONSUMPTION = MASTER_SEED;
const SEED_PRICES = MASTER_SEED + 1;
const SEED_POS = MASTER_SEED + 2;

interface MaterialMeta {
  code: string;
  description: string;
  gradeFamily: string;
  baseWeeklyMt: number; // typical weekly consumption at a reference plant
  seasonPhase: number; // radians — de-syncs the annual cycle across materials
}

const MATERIALS: MaterialMeta[] = [
  { code: "WR-5.5-HC", description: "5.5mm high-carbon wire rod", gradeFamily: "WR-STD", baseWeeklyMt: 350, seasonPhase: 0.0 },
  { code: "WR-8-MS", description: "8mm mild-steel wire rod", gradeFamily: "WR-STD", baseWeeklyMt: 280, seasonPhase: 1.2 },
  { code: "WR-12-LRPC", description: "12mm LRPC prestressing wire rod", gradeFamily: "WR-LRPC", baseWeeklyMt: 180, seasonPhase: 2.4 },
];

const PLANTS = [
  { code: "RNC", name: "Ranchi", demandMul: 1.0 },
  { code: "HSP", name: "Hospet", demandMul: 0.85 },
];

const SUPPLIERS = [
  { code: "TATA_LP", name: "Tata Long Products", type: "DOMESTIC", leadDays: 12, priceSpreadInr: -300 },
  { code: "JSW", name: "JSW Steel", type: "DOMESTIC", leadDays: 14, priceSpreadInr: 150 },
  { code: "IMPORT_GEN", name: "Generic import lot", type: "IMPORT", leadDays: 45, priceSpreadInr: 1200 },
];

// Rotation favouring domestic sourcing with periodic import lots.
const SUPPLIER_ROTATION = ["TATA_LP", "JSW", "TATA_LP", "JSW", "IMPORT_GEN"];

// Price band per grade family (₹52k–58k, integer INR). Quarterly (~13wk) swing + a
// slow annual drift + small noise, clamped to the band.
const PRICE_MIN = 52_000;
const PRICE_MAX = 58_000;
const PRICE_CENTER: Record<string, number> = { "WR-STD": 55_000, "WR-LRPC": 54_000 };
const PRICE_PHASE: Record<string, number> = { "WR-STD": 0.0, "WR-LRPC": 1.6 };

// ── date helpers (all UTC — business dates are DATE, never tz-shifted) ────────────

function iso(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

function mondayOnOrBefore(now: Date): number {
  const u = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const dow = new Date(u).getUTCDay(); // 0=Sun … 6=Sat
  const sinceMonday = (dow + 6) % 7;
  return u - sinceMonday * DAY_MS;
}

/** Monday-anchored weekly grid; weeks[WEEKS-1] is the most recent Monday ≤ `now`. */
export function buildWeeks(now: Date): { weekMs: number[]; weekIso: string[]; anchorIso: string } {
  const anchor = mondayOnOrBefore(now);
  const weekMs: number[] = [];
  for (let i = 0; i < WEEKS; i++) weekMs.push(anchor - (WEEKS - 1 - i) * 7 * DAY_MS);
  return { weekMs, weekIso: weekMs.map(iso), anchorIso: iso(anchor) };
}

// ── deterministic series generators ──────────────────────────────────────────────

const seriesKey = (mat: string, plant: string) => `${mat}|${plant}`;

/** Weekly consumption (MT) per material×plant: base × plant × seasonality × noise. */
function genConsumption(): Map<string, number[]> {
  const rng = makeRng(SEED_CONSUMPTION);
  const out = new Map<string, number[]>();
  // Fixed iteration order (material → plant → week) keeps the stream reproducible.
  for (const m of MATERIALS) {
    for (const p of PLANTS) {
      const series: number[] = [];
      for (let i = 0; i < WEEKS; i++) {
        const seasonal = 1 + 0.15 * Math.sin((2 * Math.PI * i) / 52.14 + m.seasonPhase);
        const noise = 1 + rng.range(-0.08, 0.08);
        const qty = m.baseWeeklyMt * p.demandMul * seasonal * noise;
        series.push(Math.max(1, qty));
      }
      out.set(seriesKey(m.code, p.code), series);
    }
  }
  return out;
}

/** Weekly index price (integer INR/MT) per grade family. WR-STD ends rising (FIX-3). */
function genPrices(): Map<string, number[]> {
  const rng = makeRng(SEED_PRICES);
  const out = new Map<string, number[]>();
  const families = ["WR-STD", "WR-LRPC"];
  for (const fam of families) {
    const center = PRICE_CENTER[fam];
    const phase = PRICE_PHASE[fam];
    const series: number[] = [];
    for (let i = 0; i < WEEKS; i++) {
      const quarterly = 1800 * Math.sin((2 * Math.PI * i) / 13 + phase);
      const annual = 900 * Math.sin((2 * Math.PI * i) / 52.14 + phase);
      const noise = rng.range(-250, 250);
      const raw = center + quarterly + annual + noise;
      series.push(Math.round(Math.min(PRICE_MAX, Math.max(PRICE_MIN, raw))));
    }
    out.set(fam, series);
  }
  // FIX-3: force clear upward momentum into the present on the WR-STD band. Ramp the
  // final N weeks monotonically to ~+2% above the week before the window.
  const wrStd = out.get("WR-STD")!;
  const startIdx = WEEKS - WR_STD_MOMENTUM_WEEKS;
  const base = wrStd[startIdx - 1];
  for (let j = 0; j < WR_STD_MOMENTUM_WEEKS; j++) {
    const factor = 1 + (WR_STD_END_MOMENTUM_PCT * (j + 1)) / WR_STD_MOMENTUM_WEEKS;
    wrStd[startIdx + j] = Math.min(PRICE_MAX, Math.round(base * factor));
  }
  return out;
}

const familyOf = (matCode: string) => MATERIALS.find((m) => m.code === matCode)!.gradeFamily;

// ── DB seeding ─────────────────────────────────────────────────────────────────

async function insertCodeMap(
  sql: postgres.Sql,
  table: string,
  rows: Record<string, unknown>[],
  cols: string[],
): Promise<Map<string, string>> {
  await sql`insert into ${sql(table)} ${sql(rows, ...cols)}`;
  const back = await sql`select id, code from ${sql(table)}`;
  const map = new Map<string, string>();
  for (const r of back) map.set(r.code as string, r.id as string);
  return map;
}

export interface DatasetCounts {
  plants: number;
  materials: number;
  suppliers: number;
  policies: number;
  uploadBatches: number;
  marketPrices: number;
  consumption: number;
  purchaseOrders: number;
  inventory: number;
}

export async function seedDataset(sql: postgres.Sql, adminId: string): Promise<DatasetCounts> {
  const { weekIso, weekMs, anchorIso } = buildWeeks(new Date());
  const consumption = genConsumption();
  const prices = genPrices();

  // Reference data.
  const plantIds = await insertCodeMap(
    sql,
    "plants",
    PLANTS.map((p) => ({ code: p.code, name: p.name })),
    ["code", "name"],
  );
  const materialIds = await insertCodeMap(
    sql,
    "materials",
    MATERIALS.map((m) => ({ code: m.code, description: m.description, grade_family: m.gradeFamily })),
    ["code", "description", "grade_family"],
  );
  const supplierIds = await insertCodeMap(
    sql,
    "suppliers",
    SUPPLIERS.map((s) => ({ code: s.code, name: s.name, type: s.type, lead_time_days: s.leadDays })),
    ["code", "name", "type", "lead_time_days"],
  );

  // One COMMITTED upload batch per file type, owned by admin (T4: upload_batch_id NOT NULL).
  const batchTypes = ["market_prices", "consumption", "purchase_orders", "inventory"] as const;
  const batchIds = new Map<string, string>();
  for (const t of batchTypes) {
    const [row] = await sql`
      insert into upload_batches (type, filename, status, uploaded_by)
      values (${t}, ${`seed-${t}.csv`}, 'COMMITTED', ${adminId})
      returning id`;
    batchIds.set(t, row.id as string);
  }

  // Default active policy (21/35/60/95/null).
  await sql`
    insert into policy_configs
      (min_cover_days, target_cover_days, max_supplier_share_pct, service_level_pct, wc_cap_inr, is_active, created_by)
    values (21, 35, 60.00, 95.00, null, true, ${adminId})`;

  // Market prices (weekly, per grade family).
  const priceBatch = batchIds.get("market_prices")!;
  const priceRows: Record<string, unknown>[] = [];
  for (const [fam, series] of prices) {
    for (let i = 0; i < WEEKS; i++) {
      priceRows.push({ date: weekIso[i], source: "INDEX", grade_family: fam, price_inr_mt: series[i], upload_batch_id: priceBatch });
    }
  }
  await sql`insert into market_prices ${sql(priceRows, "date", "source", "grade_family", "price_inr_mt", "upload_batch_id")}`;

  // Consumption (weekly, per material×plant).
  const consBatch = batchIds.get("consumption")!;
  const consRows: Record<string, unknown>[] = [];
  for (const m of MATERIALS) {
    for (const p of PLANTS) {
      const series = consumption.get(seriesKey(m.code, p.code))!;
      for (let i = 0; i < WEEKS; i++) {
        consRows.push({ date: weekIso[i], material_id: materialIds.get(m.code), plant_id: plantIds.get(p.code), qty_mt: series[i].toFixed(3), upload_batch_id: consBatch });
      }
    }
  }
  await sql`insert into consumption_records ${sql(consRows, "date", "material_id", "plant_id", "qty_mt", "upload_batch_id")}`;

  // PO history: replenishment every REORDER_WEEKS weeks per plant×material, rotating
  // suppliers, priced off the concurrent index ± supplier spread ± noise.
  const poBatch = batchIds.get("purchase_orders")!;
  const poRng = makeRng(SEED_POS);
  const poRows: Record<string, unknown>[] = [];
  let poSeq = 0;
  let rotation = 0;
  for (let w = REORDER_WEEKS; w < WEEKS; w += REORDER_WEEKS) {
    for (const m of MATERIALS) {
      for (const p of PLANTS) {
        const supplier = SUPPLIERS.find((s) => s.code === SUPPLIER_ROTATION[rotation % SUPPLIER_ROTATION.length])!;
        rotation++;
        const deliveryIso = iso(weekMs[w] + supplier.leadDays * DAY_MS);
        // Keep the FIX-3 breach series (WR-5.5-HC · RNC) free of open POs so its cover
        // is driven by inventory alone (≈18.2d) and the engine can't be pulled off it.
        const isBreachSeries = m.code === "WR-5.5-HC" && p.code === "RNC";
        if (isBreachSeries && deliveryIso > anchorIso) continue;

        const series = consumption.get(seriesKey(m.code, p.code))!;
        const window = series.slice(w - REORDER_WEEKS, w);
        const avgWeekly = window.reduce((a, b) => a + b, 0) / window.length;
        const qty = Math.max(1, avgWeekly * REORDER_WEEKS * (1 + poRng.range(-0.1, 0.1)));
        const indexPrice = prices.get(familyOf(m.code))![w];
        const unitPrice = Math.max(0, Math.round(indexPrice + supplier.priceSpreadInr + poRng.range(-200, 200)));
        poSeq++;
        poRows.push({
          po_number: `PO-${String(poSeq).padStart(6, "0")}`,
          po_date: weekIso[w],
          supplier_id: supplierIds.get(supplier.code),
          material_id: materialIds.get(m.code),
          plant_id: plantIds.get(p.code),
          qty_mt: qty.toFixed(3),
          unit_price_inr: unitPrice,
          delivery_date: deliveryIso,
          upload_batch_id: poBatch,
        });
      }
    }
  }
  await sql`insert into purchase_orders ${sql(poRows, "po_number", "po_date", "supplier_id", "material_id", "plant_id", "qty_mt", "unit_price_inr", "delivery_date", "upload_batch_id")}`;

  // Current inventory snapshots (as-of the anchor Monday), tuned to FIX-3 cover targets.
  const invBatch = batchIds.get("inventory")!;
  const invRows: Record<string, unknown>[] = [];
  for (const m of MATERIALS) {
    for (const p of PLANTS) {
      const series = consumption.get(seriesKey(m.code, p.code))!;
      const trailing = series.slice(WEEKS - TRAILING_WEEKS_FOR_COVER);
      const avgDaily = trailing.reduce((a, b) => a + b, 0) / trailing.length / 7;
      let coverDays = NEUTRAL_COVER_DAYS;
      if (m.code === "WR-5.5-HC" && p.code === "RNC") coverDays = COVER_BREACH_DAYS;
      else if (m.code === "WR-8-MS" && p.code === "HSP") coverDays = COMFORTABLE_COVER_DAYS;
      invRows.push({ as_of_date: anchorIso, material_id: materialIds.get(m.code), plant_id: plantIds.get(p.code), qty_mt: (coverDays * avgDaily).toFixed(3), upload_batch_id: invBatch });
    }
  }
  await sql`insert into inventory_snapshots ${sql(invRows, "as_of_date", "material_id", "plant_id", "qty_mt", "upload_batch_id")}`;

  return {
    plants: PLANTS.length,
    materials: MATERIALS.length,
    suppliers: SUPPLIERS.length,
    policies: 1,
    uploadBatches: batchTypes.length,
    marketPrices: priceRows.length,
    consumption: consRows.length,
    purchaseOrders: poRows.length,
    inventory: invRows.length,
  };
}
