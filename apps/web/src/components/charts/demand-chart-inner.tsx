"use client";

import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { formatQtyMt } from "@/app/forecasts/format";

// Recharts' Formatter<ValueType, ...> accepts number | string | (number|string)[];
// our data only ever produces a single number per point.
function formatTooltipValue(
  value: number | string | ReadonlyArray<number | string> | undefined,
): string {
  return formatQtyMt(Array.isArray(value) ? value[0] : value);
}

export interface DemandChartPoint {
  week: string;
  actual: number | null;
  forecast: number | null;
}

export interface DemandChartProps {
  data: DemandChartPoint[];
}

// Actual Recharts render, loaded only via the dynamic(..., { ssr: false }) wrapper
// in ./demand-chart.tsx (known pitfall: Recharts + SSR = hydration mismatch).
// History and forecast are two distinct Line series on one weekly x-axis (F3-AC2).
export default function DemandChartInner({ data }: DemandChartProps) {
  return (
    <div data-testid="demand-chart" className="h-72 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 8, right: 16, left: 0, bottom: 8 }}>
          <CartesianGrid strokeDasharray="3 3" />
          <XAxis dataKey="week" tick={{ fontSize: 11 }} />
          <YAxis tick={{ fontSize: 11 }} width={56} />
          <Tooltip formatter={formatTooltipValue} />
          <Legend />
          <Line
            type="monotone"
            dataKey="actual"
            name="Actual consumption"
            stroke="#374151"
            dot={false}
            isAnimationActive={false}
          />
          <Line
            type="monotone"
            dataKey="forecast"
            name="Forecast (P50)"
            stroke="#2563eb"
            strokeDasharray="5 5"
            dot={false}
            isAnimationActive={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
