import { and, desc, eq, sql } from "drizzle-orm";

import { getDb } from "@/db/client";
import {
  consumptionRecords,
  demandForecasts,
  marketPrices,
  materials,
  plants,
  priceForecasts,
  runs,
} from "@/db/schema";

import { addWeeksToIsoDate } from "./horizon";
import type { SeriesKey } from "./series";
import type { RunWarning } from "./warnings";

const HISTORY_WEEKS = 52;

/** Material x plant combos with any consumption history — the series selector
 * source for `/forecasts?tab=demand` (F3-AC2, "sourced server-side"). */
export async function getSeriesOptions(): Promise<SeriesKey[]> {
  const db = getDb();
  return db
    .selectDistinct({ materialCode: materials.code, plantCode: plants.code })
    .from(consumptionRecords)
    .innerJoin(materials, eq(consumptionRecords.materialId, materials.id))
    .innerJoin(plants, eq(consumptionRecords.plantId, plants.id))
    .orderBy(materials.code, plants.code);
}

export interface LatestRun {
  id: string;
  warnings: RunWarning[];
}

/** Most recently finished run. Forecasts and F3-ERR1 warnings for the demand tab
 * always read off this run; a run stuck QUEUED/RUNNING/FAILED has no usable
 * demand_forecasts rows yet, so "no DONE run" collapses to the same empty state
 * as "no run at all" (task card point 2). */
export async function getLatestDoneRun(): Promise<LatestRun | null> {
  const db = getDb();
  const [run] = await db
    .select({ id: runs.id, warnings: runs.warnings })
    .from(runs)
    .where(eq(runs.status, "DONE"))
    .orderBy(desc(runs.finishedAt))
    .limit(1);

  if (!run) return null;
  return {
    id: run.id,
    warnings: Array.isArray(run.warnings) ? (run.warnings as RunWarning[]) : [],
  };
}

export interface DemandPoint {
  week: string;
  qtyMt: number;
}

export interface DemandSeriesData {
  history: DemandPoint[];
  forecast: DemandPoint[];
  model: string | null;
  backtestWape: number | null;
}

/** History (last ~52 ISO weeks, Monday-start via `date_trunc('week', ...)` — same
 * bucketing convention the engine uses) plus the given run's 12-week forecast for
 * one material x plant series (F3-AC2). Returns null when the series codes don't
 * resolve to a real material/plant (bad/stale query param). */
export async function getDemandSeriesData(
  series: SeriesKey,
  runId: string,
): Promise<DemandSeriesData | null> {
  const db = getDb();

  const [material] = await db
    .select({ id: materials.id })
    .from(materials)
    .where(eq(materials.code, series.materialCode))
    .limit(1);
  const [plant] = await db
    .select({ id: plants.id })
    .from(plants)
    .where(eq(plants.code, series.plantCode))
    .limit(1);
  if (!material || !plant) return null;

  const weekExpr = sql`date_trunc('week', ${consumptionRecords.date})`;

  const historyRows = await db
    .select({
      week: sql<string>`(${weekExpr})::date`,
      qtyMt: sql<string>`sum(${consumptionRecords.qtyMt})`,
    })
    .from(consumptionRecords)
    .where(
      and(
        eq(consumptionRecords.materialId, material.id),
        eq(consumptionRecords.plantId, plant.id),
      ),
    )
    .groupBy(weekExpr)
    .orderBy(desc(weekExpr))
    .limit(HISTORY_WEEKS);

  const forecastRows = await db
    .select({
      week: demandForecasts.week,
      qtyMt: demandForecasts.p50QtyMt,
      model: demandForecasts.model,
      backtestWape: demandForecasts.backtestWape,
    })
    .from(demandForecasts)
    .where(
      and(
        eq(demandForecasts.runId, runId),
        eq(demandForecasts.materialId, material.id),
        eq(demandForecasts.plantId, plant.id),
      ),
    )
    .orderBy(demandForecasts.week);

  return {
    history: historyRows
      .slice()
      .reverse()
      .map((r) => ({ week: r.week, qtyMt: Number(r.qtyMt) })),
    forecast: forecastRows.map((r) => ({ week: r.week, qtyMt: Number(r.qtyMt) })),
    model: forecastRows[0]?.model ?? null,
    backtestWape: forecastRows[0] ? Number(forecastRows[0].backtestWape) : null,
  };
}

const PRICE_HISTORY_WEEKS = 52;

/** grade_families with any market-price history — the selector source for
 * `/forecasts?tab=price` (F4-AC2), mirroring getSeriesOptions for demand. */
export async function getGradeFamilyOptions(): Promise<string[]> {
  const db = getDb();
  const rows = await db
    .selectDistinct({ gradeFamily: marketPrices.gradeFamily })
    .from(marketPrices)
    .orderBy(marketPrices.gradeFamily);
  return rows.map((r) => r.gradeFamily);
}

export interface PricePoint {
  week: string;
  priceInrMt: number;
}

export interface PriceBandPoint {
  week: string;
  horizonWeeks: number;
  p10InrMt: number;
  p50InrMt: number;
  p90InrMt: number;
  coverage8090: number | null;
}

export interface PriceSeriesData {
  history: PricePoint[];
  bands: PriceBandPoint[];
}

/** History (last ~52 weekly market_prices rows) plus the given run's 1w/4w/12w
 * bands for one grade_family (F4-AC2). Each band horizon is anchored to a
 * calendar week after the last history week (task card point 1). Returns null
 * when there is no price history for this grade_family at all. */
export async function getPriceSeriesData(
  gradeFamily: string,
  runId: string,
): Promise<PriceSeriesData | null> {
  const db = getDb();

  const historyRows = await db
    .select({ week: marketPrices.date, priceInrMt: marketPrices.priceInrMt })
    .from(marketPrices)
    .where(eq(marketPrices.gradeFamily, gradeFamily))
    .orderBy(desc(marketPrices.date))
    .limit(PRICE_HISTORY_WEEKS);

  if (historyRows.length === 0) return null;

  const lastHistoryWeek = historyRows[0].week;

  const bandRows = await db
    .select({
      horizonWeeks: priceForecasts.horizonWeeks,
      p10InrMt: priceForecasts.p10InrMt,
      p50InrMt: priceForecasts.p50InrMt,
      p90InrMt: priceForecasts.p90InrMt,
      coverage8090: priceForecasts.coverage8090,
    })
    .from(priceForecasts)
    .where(and(eq(priceForecasts.runId, runId), eq(priceForecasts.gradeFamily, gradeFamily)))
    .orderBy(priceForecasts.horizonWeeks);

  return {
    history: historyRows
      .slice()
      .reverse()
      .map((r) => ({ week: r.week, priceInrMt: r.priceInrMt })),
    bands: bandRows.map((r) => ({
      week: addWeeksToIsoDate(lastHistoryWeek, r.horizonWeeks),
      horizonWeeks: r.horizonWeeks,
      p10InrMt: r.p10InrMt,
      p50InrMt: r.p50InrMt,
      p90InrMt: r.p90InrMt,
      coverage8090: r.coverage8090 !== null ? Number(r.coverage8090) : null,
    })),
  };
}
