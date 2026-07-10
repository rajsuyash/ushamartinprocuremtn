import type { SeriesKey } from "./series";

// Shape written by the engine's demand stage and persisted verbatim (snake_case,
// as the engine emits it — see services/engine/src/pdi_engine/api/stages.py and
// apps/web/src/lib/run-orchestrator.ts) onto `runs.warnings` jsonb.
export interface RunWarning {
  code: string;
  material_code?: string;
  plant_code?: string;
  stage?: string;
  detail?: string;
}

/** F3-ERR1: true when the latest run flagged this exact series as
 * INSUFFICIENT_HISTORY — the UI renders the chip instead of the chart. */
export function hasInsufficientHistoryWarning(
  warnings: readonly RunWarning[],
  series: SeriesKey,
): boolean {
  return warnings.some(
    (w) =>
      w.code === "INSUFFICIENT_HISTORY" &&
      w.material_code === series.materialCode &&
      w.plant_code === series.plantCode,
  );
}
