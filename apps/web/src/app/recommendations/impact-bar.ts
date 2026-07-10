// Pure math for the P10/P50/P90 expected-impact range bar (detail page). No
// React/db import — unit-testable in isolation (task card point 3).
//
// The domain always includes 0 alongside the three deltas, so the bar can show
// where "no cost change" sits even when the whole range is a saving (all
// negative) or a cost increase (all positive) — otherwise a reader can't tell
// a savings bar from a cost-increase bar at a glance.
export interface ImpactBarLayout {
  min: number;
  max: number;
  p10Pct: number;
  p50Pct: number;
  p90Pct: number;
  zeroPct: number;
}

export function computeImpactBarLayout(
  costDeltaP10Inr: number,
  costDeltaInr: number,
  costDeltaP90Inr: number,
): ImpactBarLayout {
  const min = Math.min(costDeltaP10Inr, costDeltaInr, costDeltaP90Inr, 0);
  const max = Math.max(costDeltaP10Inr, costDeltaInr, costDeltaP90Inr, 0);
  const span = max - min;
  // A degenerate (zero-width) span — e.g. every value is exactly 0 — centers
  // every marker rather than dividing by zero.
  const pct = (v: number) => (span === 0 ? 50 : ((v - min) / span) * 100);

  return {
    min,
    max,
    p10Pct: pct(costDeltaP10Inr),
    p50Pct: pct(costDeltaInr),
    p90Pct: pct(costDeltaP90Inr),
    zeroPct: pct(0),
  };
}
