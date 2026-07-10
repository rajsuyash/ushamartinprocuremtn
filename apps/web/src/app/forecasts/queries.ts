import { and, desc, eq, sql } from "drizzle-orm";

import { getDb } from "@/db/client";
import { consumptionRecords, demandForecasts, materials, plants, runs } from "@/db/schema";

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
