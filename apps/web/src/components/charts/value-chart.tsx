"use client";

import dynamic from "next/dynamic";

import type { ValueChartProps } from "./value-chart-inner";

// Recharts must never render on the server (known-pitfalls.md: hydration
// mismatch) — `next/dynamic` with `ssr: false` is only legal inside a Client
// Component, hence this thin wrapper around the real chart module.
const ValueChartInner = dynamic(() => import("./value-chart-inner"), {
  ssr: false,
  loading: () => (
    <div className="flex h-72 items-center justify-center text-sm text-muted">
      Loading chart…
    </div>
  ),
});

export function ValueChart(props: ValueChartProps) {
  return <ValueChartInner {...props} />;
}
