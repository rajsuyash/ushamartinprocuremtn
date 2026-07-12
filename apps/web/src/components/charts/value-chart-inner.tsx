"use client";

import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { formatMoneyInr } from "@/app/reports/pilot/format";

// Recharts' Formatter<ValueType, ...> accepts number | string | (number|string)[];
// our data only ever produces a single number per point.
function formatTooltipValue(
  value: number | string | ReadonlyArray<number | string> | undefined,
): string {
  return formatMoneyInr(Array.isArray(value) ? Number(value[0]) : Number(value));
}

export interface ValueChartPoint {
  decidedAt: string;
  cumulativeValueInr: number;
}

export interface ValueChartProps {
  data: ValueChartPoint[];
}

// Actual Recharts render, loaded only via the dynamic(..., { ssr: false }) wrapper
// in ./value-chart.tsx (known pitfall: Recharts + SSR = hydration mismatch).
// Single cumulative-value line over decidedAt (PRD §6 F8: "cumulative value line").
export default function ValueChartInner({ data }: ValueChartProps) {
  return (
    <div data-testid="value-chart" className="h-72 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 8, right: 16, left: 0, bottom: 8 }}>
          <CartesianGrid strokeDasharray="3 3" />
          <XAxis dataKey="decidedAt" tick={{ fontSize: 11 }} />
          <YAxis tick={{ fontSize: 11 }} width={72} tickFormatter={(v) => formatMoneyInr(v)} />
          <Tooltip formatter={formatTooltipValue} />
          <Line
            type="monotone"
            dataKey="cumulativeValueInr"
            name="Cumulative value"
            stroke="#1a2b3c"
            dot={false}
            isAnimationActive={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
