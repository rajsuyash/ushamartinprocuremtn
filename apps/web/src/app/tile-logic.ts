// Pure helpers for the dashboard cockpit tiles (F6-AC1). No db/React import —
// unit-testable without mocking. Everything here reads off the recommendation's
// STORED rationale JSON (services/engine/.../recommend/rationale.py) — never
// recomputed (known pitfall: audit view must never drift from what was decided on).

// Exact shape `build_rationale()` writes (PRD F5 example, confirmed against the
// live seeded DB). `error` is populated instead of `inputs` for F5-ERR1/ERR3
// degraded (status=ERROR) rows.
export interface RecommendationRationale {
  inputs?: {
    coverDays: number;
    minCoverDays: number;
    band4w: { p10: number; p50: number; p90: number };
    spotInrMt: number;
    spread: Record<string, number>;
  };
  drivers?: { factor: string; detail: string }[];
  constraintsRespected?: string[];
  error?: { code: string; [key: string]: unknown };
}

export type BandDirection = "rising" | "flat" | "falling";

// Mirrors the engine's RISE_EPS (services/engine/.../recommend/classifier.py) so
// the tile's arrow agrees with the same rising/flat call the recommendation made.
const DIRECTION_EPS = 0.01;

/** 4w band P50 vs spot -> rising/flat/falling arrow (F6 tile stat). */
export function classifyBandDirection(p50: number, spotInrMt: number): BandDirection {
  if (spotInrMt <= 0) return "flat";
  const change = p50 / spotInrMt - 1;
  if (change > DIRECTION_EPS) return "rising";
  if (change < -DIRECTION_EPS) return "falling";
  return "flat";
}

export interface BestOffer {
  supplierCode: string;
  priceInrMt: number;
}

/** Lowest offer among the rationale's supplier spread — "best supplier spread"
 * tile stat. Null when the spread map is empty (degraded/error rows). */
export function bestSupplierOffer(spread: Record<string, number>): BestOffer | null {
  const entries = Object.entries(spread);
  if (entries.length === 0) return null;
  return entries.reduce<BestOffer>(
    (best, [supplierCode, priceInrMt]) =>
      priceInrMt < best.priceInrMt ? { supplierCode, priceInrMt } : best,
    { supplierCode: entries[0][0], priceInrMt: entries[0][1] },
  );
}

/** Breach styling trigger — cover below the policy floor embedded in this
 * recommendation's own rationale.inputs (F6-AC1: "cover in breach styling"). */
export function isCoverBreach(coverDays: number, minCoverDays: number): boolean {
  return coverDays < minCoverDays;
}
