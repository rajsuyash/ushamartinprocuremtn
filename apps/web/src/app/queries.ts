import { desc, eq } from "drizzle-orm";

import { getDb } from "@/db/client";
import { materials, plants, recommendations, runs } from "@/db/schema";

import type { RecommendationRationale } from "./tile-logic";

export interface LatestRunSummary {
  id: string;
  finishedAt: string | null;
  counts: Record<string, unknown>;
}

/** Most recently finished run — the dashboard's tiles and banner both read off
 * this run only (F6-AC1). Mirrors forecasts/queries.ts's getLatestDoneRun, plus
 * the finishedAt/counts fields the banner needs. */
export async function getLatestDoneRun(): Promise<LatestRunSummary | null> {
  const db = getDb();
  const [run] = await db
    .select({ id: runs.id, finishedAt: runs.finishedAt, counts: runs.counts })
    .from(runs)
    .where(eq(runs.status, "DONE"))
    .orderBy(desc(runs.finishedAt))
    .limit(1);

  if (!run) return null;
  return {
    id: run.id,
    finishedAt: run.finishedAt ? run.finishedAt.toISOString() : null,
    counts: (run.counts ?? {}) as Record<string, unknown>,
  };
}

export interface DashboardTile {
  recommendationId: string;
  materialCode: string;
  plantCode: string;
  status: string;
  rationale: RecommendationRationale;
}

/** One row per material x plant recommendation on the given run (F6-AC1 tiles) —
 * one tile per series that produced any recommendation this run, regardless of
 * status. Rendered straight from the stored rationale jsonb, never recomputed. */
export async function getDashboardTiles(runId: string): Promise<DashboardTile[]> {
  const db = getDb();
  const rows = await db
    .select({
      recommendationId: recommendations.id,
      materialCode: materials.code,
      plantCode: plants.code,
      status: recommendations.status,
      rationale: recommendations.rationale,
    })
    .from(recommendations)
    .innerJoin(materials, eq(materials.id, recommendations.materialId))
    .innerJoin(plants, eq(plants.id, recommendations.plantId))
    .where(eq(recommendations.runId, runId))
    .orderBy(materials.code, plants.code);

  return rows.map((r) => ({
    ...r,
    rationale: (r.rationale ?? {}) as RecommendationRationale,
  }));
}
