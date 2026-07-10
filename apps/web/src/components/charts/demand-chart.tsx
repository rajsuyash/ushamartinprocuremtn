"use client";

import dynamic from "next/dynamic";

import type { DemandChartProps } from "./demand-chart-inner";

// Recharts must never render on the server (known-pitfalls.md: hydration
// mismatch) — `next/dynamic` with `ssr: false` is only legal inside a Client
// Component, hence this thin wrapper around the real chart module.
const DemandChartInner = dynamic(() => import("./demand-chart-inner"), {
  ssr: false,
  loading: () => (
    <div className="flex h-72 items-center justify-center text-sm text-gray-400">
      Loading chart…
    </div>
  ),
});

export function DemandChart(props: DemandChartProps) {
  return <DemandChartInner {...props} />;
}
