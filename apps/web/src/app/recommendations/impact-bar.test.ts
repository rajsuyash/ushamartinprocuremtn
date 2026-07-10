import { describe, expect, it } from "vitest";

import { computeImpactBarLayout } from "./impact-bar";

describe("computeImpactBarLayout", () => {
  it("orders P10 < P50 < P90 as increasing percentages (all-savings case)", () => {
    // PRD F5 example: costDeltaInr -1,830,000, P10 -3,400,000, P90 -200,000.
    const layout = computeImpactBarLayout(-3_400_000, -1_830_000, -200_000);
    expect(layout.p10Pct).toBeLessThan(layout.p50Pct);
    expect(layout.p50Pct).toBeLessThan(layout.p90Pct);
    // The whole range is a saving — zero sits at the top of the domain.
    expect(layout.zeroPct).toBe(100);
  });

  it("places zero inside the range when the delta straddles it (real seeded row)", () => {
    // Live seeded FIX-2 row: P10 -162536, P50 58104, P90 108624.
    const layout = computeImpactBarLayout(-162_536, 58_104, 108_624);
    expect(layout.zeroPct).toBeGreaterThan(0);
    expect(layout.zeroPct).toBeLessThan(100);
    expect(layout.p10Pct).toBe(0);
    expect(layout.p90Pct).toBe(100);
  });

  it("places zero at the bottom when the whole range is a cost increase", () => {
    const layout = computeImpactBarLayout(100_000, 200_000, 300_000);
    expect(layout.zeroPct).toBe(0);
  });

  it("centers every marker at 50% for a degenerate all-zero range", () => {
    const layout = computeImpactBarLayout(0, 0, 0);
    expect(layout.p10Pct).toBe(50);
    expect(layout.p50Pct).toBe(50);
    expect(layout.p90Pct).toBe(50);
    expect(layout.zeroPct).toBe(50);
  });
});
