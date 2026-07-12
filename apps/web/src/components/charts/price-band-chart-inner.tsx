"use client";

import {
  Area,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { formatPriceInrMt } from "@/app/forecasts/format";

// Recharts' Formatter<ValueType, ...> accepts number | string | (number|string)[];
// our data only ever produces a single number per point.
function formatTooltipValue(
  value: number | string | ReadonlyArray<number | string> | undefined,
): string {
  return formatPriceInrMt(Array.isArray(value) ? value[0] : value);
}

export interface PriceBandChartPoint {
  week: string;
  price: number | null;
  p10: number | null;
  p50: number | null;
  p90: number | null;
}

export interface PriceBandChartProps {
  data: PriceBandChartPoint[];
}

// Actual Recharts render, loaded only via the dynamic(..., { ssr: false }) wrapper
// in ./price-band-chart.tsx (known pitfall: Recharts + SSR = hydration mismatch).
// The P10-P90 "decision band" (PRD F4: never call it a "prediction") is drawn as
// two stacked Areas — an invisible base up to p10, then a visible fill for the
// p10-p90 span — with the P50 line on top (F4-AC2). History price and the band
// occupy disjoint weeks in `data`, so `connectNulls` draws each series only
// across its own non-null points.
export default function PriceBandChartInner({ data }: PriceBandChartProps) {
  const chartData = data.map((p) => ({
    ...p,
    bandSpan: p.p10 !== null && p.p90 !== null ? p.p90 - p.p10 : null,
  }));

  // Explicit numeric domain: the stacked band Areas turn null p10s into 0s,
  // which drags Recharts' computed dataMin to 0 and squashes a ₹52-57k series
  // into the top of the plot. Derive the domain from the real values instead.
  const values = data.flatMap((p) => [p.price, p.p10, p.p50, p.p90]).filter(
    (v): v is number => v !== null,
  );
  const yDomain: [number, number] =
    values.length > 0
      ? [Math.min(...values) - 1000, Math.max(...values) + 1000]
      : [0, 1];

  return (
    <div data-testid="price-band-chart" className="h-72 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={chartData} margin={{ top: 8, right: 16, left: 0, bottom: 8 }}>
          <CartesianGrid strokeDasharray="3 3" />
          <XAxis dataKey="week" tick={{ fontSize: 11 }} />
          <YAxis
            tick={{ fontSize: 11 }}
            width={64}
            tickFormatter={formatPriceInrMt}
            domain={yDomain}
            allowDataOverflow
          />
          <Tooltip formatter={formatTooltipValue} />
          <Legend />
          <Area
            dataKey="p10"
            stackId="band"
            name="P10"
            stroke="none"
            fill="transparent"
            connectNulls
            isAnimationActive={false}
            legendType="none"
          />
          <Area
            dataKey="bandSpan"
            stackId="band"
            name="P10–P90 (decision band)"
            stroke="none"
            fill="#1a2b3c"
            fillOpacity={0.15}
            connectNulls
            isAnimationActive={false}
          />
          <Line
            type="monotone"
            dataKey="p50"
            name="Forecast (P50)"
            stroke="#eb6a1b"
            strokeDasharray="5 5"
            dot
            connectNulls
            isAnimationActive={false}
          />
          <Line
            type="monotone"
            dataKey="price"
            name="Market price"
            stroke="#1a2b3c"
            dot={false}
            isAnimationActive={false}
          />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}
