import type { DecisionActionInput, Play } from "@pdi/shared";
import { inArray, sql } from "drizzle-orm";

import { getDb } from "@/db/client";
import { decisionRecords, materials, plants, recommendations } from "@/db/schema";

// T30 · Value engine (PRD §6 F8 + §13 "Baseline"). Pure read path — computed on every
// call from committed data + decision records; nothing here writes a new table, so
// actualization (F8-AC2) never mutates a decision's stored inputs (known pitfall).
//
// Money: baseline/plan/value are integer INR. Quantities are numeric(12,3) MT and
// arrive from Postgres as strings — parsed to number here (pilot-scale rows only,
// never a precision-critical ledger operation).
//
// ASSUMPTION (OVERRIDDEN handling, PRD §6 F8 doesn't spell this out): DecisionRecord
// .override only ever carries `{ play }`, never re-computed order lines — the engine
// never re-solves the MILP for the human's alternate play. So:
//   - APPROVE, or OVERRIDE that names the SAME play the system proposed: the stored
//     recommendation.orderLines were the executed plan.
//   - OVERRIDE to a DIFFERENT play (e.g. system said BUY_NOW, human chose WAIT): there
//     is no computed order-line data for that alternate play, so executed quantity is
//     0 — never fabricate a plan nobody approved. This is the general form of "WAIT-
//     like overrides value = 0"; it covers any diverging override, not only WAIT.

export type ValueRowState = "ESTIMATED" | "ACTUALIZED" | "BASELINE_UNAVAILABLE";

interface OrderLine {
  supplierCode: string;
  qtyMt: number;
  targetWeek: string;
  estPriceInrMt: number;
}

export interface DecisionValueRow {
  recommendationId: string;
  materialCode: string;
  plantCode: string;
  systemPlay: Play | null;
  humanAction: DecisionActionInput;
  overridePlay: Play | null;
  decidedAt: string;
  qtyMt: number;
  baselineInrMt: number | null;
  baselineCostInr: number | null;
  planCostInr: number;
  valueInr: number | null;
  state: ValueRowState;
}

export interface ValueReport {
  decisions: DecisionValueRow[];
  cumulative: { decidedAt: string; cumulativeValueInr: number }[];
  summary: {
    totalValueInr: number;
    decidedCount: number;
    totalRecommendations: number;
    adoptionPct: number;
  };
}

// ±1 week match window for actualization (PRD F8: "matched by supplier+material+week ±1").
const ACTUAL_PO_WINDOW_DAYS = 7;

function orderLinesOf(raw: unknown): OrderLine[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((l) => {
    const line = l as Record<string, unknown>;
    return {
      supplierCode: String(line.supplierCode),
      qtyMt: Number(line.qtyMt),
      targetWeek: String(line.targetWeek),
      estPriceInrMt: Number(line.estPriceInrMt),
    };
  });
}

/** See module header ASSUMPTION for the OVERRIDDEN rule. */
function executedOrderLines(
  action: DecisionActionInput,
  systemPlay: Play | null,
  overridePlay: Play | null,
  storedOrderLines: unknown,
): OrderLine[] {
  if (action === "OVERRIDE" && overridePlay !== systemPlay) return [];
  return orderLinesOf(storedOrderLines);
}

// Rounding: money is integer INR — round once, at the point a cost total is finalized,
// never per-line, to avoid compounding rounding error across order lines.
function round(n: number): number {
  return Math.round(n);
}

function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}

function toIso(d: Date | string): string {
  return d instanceof Date ? d.toISOString() : new Date(d).toISOString();
}

function addDays(dateStr: string, days: number): string {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * Decision-month average committed market price for a grade family (PRD §13 Baseline:
 * "decision-month average market price × quantity"). Rounded to the nearest integer INR
 * (SQL ROUND, half-up) — a display-level aggregate, not a per-transaction ledger, so a
 * half-rupee tie-break has no material effect. Returns null when zero prices exist that
 * month (F8-ERR2 BASELINE_UNAVAILABLE) — never silently 0.
 */
async function baselineForMonth(gradeFamily: string, decidedAt: Date): Promise<number | null> {
  const db = getDb();
  const decidedAtIso = decidedAt.toISOString();
  const rows = await db.execute(sql`
    select round(avg(price_inr_mt))::int as avg_price, count(*)::int as n
    from market_prices
    where grade_family = ${gradeFamily}
      and date_trunc('month', date)::date = date_trunc('month', ${decidedAtIso}::timestamptz)::date
  `);
  const row = rows[0] as { avg_price: number | null; n: number } | undefined;
  return row && row.n > 0 ? row.avg_price! : null;
}

/**
 * Actual unit price for one order line, if a matching committed PO exists (F8-AC2:
 * same supplier + material + plant, delivery_date within ±1 week of targetWeek). Nearest
 * delivery date wins on multiple matches.
 */
async function actualPriceFor(
  materialId: string,
  plantId: string,
  line: OrderLine,
): Promise<number | null> {
  const db = getDb();
  const from = addDays(line.targetWeek, -ACTUAL_PO_WINDOW_DAYS);
  const to = addDays(line.targetWeek, ACTUAL_PO_WINDOW_DAYS);
  const rows = await db.execute(sql`
    select po.unit_price_inr as unit_price_inr
    from purchase_orders po
    join suppliers s on s.id = po.supplier_id
    where s.code = ${line.supplierCode}
      and po.material_id = ${materialId}
      and po.plant_id = ${plantId}
      and po.delivery_date between ${from} and ${to}
    order by abs(po.delivery_date - ${line.targetWeek}::date) asc
    limit 1
  `);
  const row = rows[0] as { unit_price_inr: number } | undefined;
  return row ? row.unit_price_inr : null;
}

/** Sum of estimated line costs (qty × estPriceInrMt), unrounded — caller rounds once. */
function estimatedCost(lines: OrderLine[]): number {
  return lines.reduce((sum, l) => sum + l.qtyMt * l.estPriceInrMt, 0);
}

// ponytail: per-decision baseline + per-line actual-PO lookups are N+1 queries. Fine at
// pilot scale (a handful of decisions per week, PRD §11); batch by decision-month /
// supplier+material if the decision ledger ever grows past hundreds of rows.
async function priceWithActuals(
  materialId: string,
  plantId: string,
  lines: OrderLine[],
): Promise<{ planCostInr: number; allMatched: boolean }> {
  let costRaw = 0;
  let matched = 0;
  for (const line of lines) {
    const actual = await actualPriceFor(materialId, plantId, line);
    costRaw += line.qtyMt * (actual ?? line.estPriceInrMt);
    if (actual !== null) matched += 1;
  }
  return { planCostInr: round(costRaw), allMatched: lines.length > 0 && matched === lines.length };
}

interface DecidedRow {
  recommendationId: string;
  materialCode: string;
  gradeFamily: string;
  plantCode: string;
  systemPlay: Play | null;
  orderLines: unknown;
  humanAction: DecisionActionInput;
  override: unknown;
  decidedAt: Date | string;
  materialId: string;
  plantId: string;
}

async function loadDecidedRows(): Promise<DecidedRow[]> {
  const db = getDb();
  const rows = await db
    .select({
      recommendationId: recommendations.id,
      materialCode: materials.code,
      gradeFamily: materials.gradeFamily,
      plantCode: plants.code,
      systemPlay: recommendations.play,
      orderLines: recommendations.orderLines,
      humanAction: decisionRecords.action,
      override: decisionRecords.override,
      decidedAt: decisionRecords.decidedAt,
      materialId: recommendations.materialId,
      plantId: recommendations.plantId,
    })
    .from(decisionRecords)
    .innerJoin(recommendations, sql`${recommendations.id} = ${decisionRecords.recommendationId}`)
    .innerJoin(materials, sql`${materials.id} = ${recommendations.materialId}`)
    .innerJoin(plants, sql`${plants.id} = ${recommendations.plantId}`)
    // REJECTED has no executed plan (PRD task): only APPROVED/OVERRIDDEN carry value.
    .where(inArray(recommendations.status, ["APPROVED", "OVERRIDDEN"]))
    .orderBy(decisionRecords.decidedAt);
  return rows as unknown as DecidedRow[];
}

/** Adoption = share of (non-ERROR) recommendations ever produced that have been decided. */
async function adoptionStats(): Promise<{ total: number; decided: number }> {
  const db = getDb();
  const rows = await db.execute(sql`
    select
      count(*) filter (where status <> 'ERROR')::int as total,
      count(*) filter (where status in ('APPROVED', 'OVERRIDDEN', 'REJECTED'))::int as decided
    from recommendations
  `);
  const row = rows[0] as { total: number; decided: number };
  return { total: row.total, decided: row.decided };
}

/** Builds the full value report for /reports/pilot (T31). See module header for rules. */
export async function computeValueReport(): Promise<ValueReport> {
  const decidedRows = await loadDecidedRows();
  const decisions: DecisionValueRow[] = [];

  for (const r of decidedRows) {
    const overridePlay = (r.override as { play: Play } | null)?.play ?? null;
    const lines = executedOrderLines(r.humanAction, r.systemPlay, overridePlay, r.orderLines);
    const qtyMt = round3(lines.reduce((sum, l) => sum + l.qtyMt, 0));
    const base = {
      recommendationId: r.recommendationId,
      materialCode: r.materialCode,
      plantCode: r.plantCode,
      systemPlay: r.systemPlay,
      humanAction: r.humanAction,
      overridePlay,
      decidedAt: toIso(r.decidedAt),
    };

    if (qtyMt === 0) {
      decisions.push({
        ...base,
        qtyMt: 0,
        baselineInrMt: null,
        baselineCostInr: 0,
        planCostInr: 0,
        valueInr: 0,
        state: "ESTIMATED",
      });
      continue;
    }

    const baselineInrMt = await baselineForMonth(r.gradeFamily, new Date(r.decidedAt));
    if (baselineInrMt === null) {
      decisions.push({
        ...base,
        qtyMt,
        baselineInrMt: null,
        baselineCostInr: null,
        planCostInr: round(estimatedCost(lines)),
        valueInr: null,
        state: "BASELINE_UNAVAILABLE",
      });
      continue;
    }

    const baselineCostInr = round(baselineInrMt * qtyMt);
    const { planCostInr, allMatched } = await priceWithActuals(r.materialId, r.plantId, lines);

    decisions.push({
      ...base,
      qtyMt,
      baselineInrMt,
      baselineCostInr,
      planCostInr,
      valueInr: baselineCostInr - planCostInr,
      state: allMatched ? "ACTUALIZED" : "ESTIMATED",
    });
  }

  const cumulative: { decidedAt: string; cumulativeValueInr: number }[] = [];
  let running = 0;
  for (const row of decisions) {
    if (row.valueInr === null) continue; // BASELINE_UNAVAILABLE excluded (F8-ERR2)
    running += row.valueInr;
    cumulative.push({ decidedAt: row.decidedAt, cumulativeValueInr: running });
  }

  const { total, decided } = await adoptionStats();

  return {
    decisions,
    cumulative,
    summary: {
      totalValueInr: running,
      decidedCount: decided,
      totalRecommendations: total,
      adoptionPct: total > 0 ? Math.round((decided / total) * 1000) / 10 : 0,
    },
  };
}
