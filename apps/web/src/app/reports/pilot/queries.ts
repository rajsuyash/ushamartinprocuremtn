import { and, eq } from "drizzle-orm";

import { getDb } from "@/db/client";
import { demandForecasts, materials, plants, priceForecasts } from "@/db/schema";

import { dedupeDemandQuality, type DemandQualityRow } from "./quality";

// The 4-week horizon is the canonical one shown elsewhere (forecasts/page.tsx
// COVERAGE_BADGE_HORIZON_WEEKS) — reused here so the pilot report's coverage
// figure matches what the buyer already sees on /forecasts.
const COVERAGE_HORIZON_WEEKS = 4;

/** Per-series demand WAPE for the given run (T31 forecast-quality panel). */
export async function getDemandQuality(runId: string): Promise<DemandQualityRow[]> {
  const db = getDb();
  const rows = await db
    .select({
      materialCode: materials.code,
      plantCode: plants.code,
      model: demandForecasts.model,
      backtestWape: demandForecasts.backtestWape,
    })
    .from(demandForecasts)
    .innerJoin(materials, eq(demandForecasts.materialId, materials.id))
    .innerJoin(plants, eq(demandForecasts.plantId, plants.id))
    .where(eq(demandForecasts.runId, runId))
    .orderBy(materials.code, plants.code);
  return dedupeDemandQuality(rows);
}

export interface GradeQualityRow {
  gradeFamily: string;
  coverage8090: number | null;
}

/** Per-grade-family 4w band coverage for the given run (decision-band honesty
 * metric, PRD F4 "Coverage is the honesty metric — display even when unflattering"). */
export async function getPriceQuality(runId: string): Promise<GradeQualityRow[]> {
  const db = getDb();
  const rows = await db
    .select({
      gradeFamily: priceForecasts.gradeFamily,
      coverage8090: priceForecasts.coverage8090,
    })
    .from(priceForecasts)
    .where(
      and(eq(priceForecasts.runId, runId), eq(priceForecasts.horizonWeeks, COVERAGE_HORIZON_WEEKS)),
    )
    .orderBy(priceForecasts.gradeFamily);
  return rows.map((r) => ({
    gradeFamily: r.gradeFamily,
    coverage8090: r.coverage8090 !== null ? Number(r.coverage8090) : null,
  }));
}
