// Pure aggregation for the /reports/pilot forecast-quality panel (T31, PRD §6 F8
// "forecast-quality panel (WAPE, band coverage)"). Kept separate from db access
// so it's unit-testable without a live Postgres connection.

export interface RawDemandQualityRow {
  materialCode: string;
  plantCode: string;
  model: string;
  backtestWape: number | string;
}

export interface DemandQualityRow {
  materialCode: string;
  plantCode: string;
  model: string;
  backtestWape: number;
}

/**
 * demand_forecasts carries the same (model, backtestWape) on all 12 weekly rows
 * of a series (T13/T14 per-series winner selection) — dedupe to one row per
 * material x plant so the panel doesn't repeat a series 12 times. First
 * occurrence wins; input order doesn't matter for correctness since all rows
 * of a series are identical on these fields.
 */
export function dedupeDemandQuality(rows: RawDemandQualityRow[]): DemandQualityRow[] {
  const seen = new Map<string, DemandQualityRow>();
  for (const r of rows) {
    const key = `${r.materialCode}::${r.plantCode}`;
    if (!seen.has(key)) {
      seen.set(key, {
        materialCode: r.materialCode,
        plantCode: r.plantCode,
        model: r.model,
        backtestWape: Number(r.backtestWape),
      });
    }
  }
  return [...seen.values()];
}
