import Link from "next/link";

import { DemandChart } from "@/components/charts/demand-chart";

import { formatQtyMt } from "./format";
import { getDemandSeriesData, getLatestDoneRun, getSeriesOptions } from "./queries";
import { formatSeriesKey, parseSeriesParam, seriesEquals, type SeriesKey } from "./series";
import { hasInsufficientHistoryWarning } from "./warnings";

interface ForecastsPageProps {
  searchParams: Promise<{ tab?: string; series?: string }>;
}

const TABS = [
  { key: "demand", label: "Demand" },
  { key: "price", label: "Price" },
] as const;

// Server component (F3-AC2): fetches series options, the latest run, and the
// selected series' history + forecast directly via db — no client fetch, no
// /api route. Simpler than adding an API route for data only this page needs;
// documented per the task card's "pick simpler" instruction.
export default async function ForecastsPage({ searchParams }: ForecastsPageProps) {
  const params = await searchParams;
  const tab = params.tab === "price" ? "price" : "demand";

  const seriesOptions = await getSeriesOptions();
  const requested = parseSeriesParam(params.series);
  const selected =
    (requested && seriesOptions.find((s) => seriesEquals(s, requested))) ??
    seriesOptions[0] ??
    null;

  return (
    <main className="mx-auto max-w-4xl space-y-6 p-8">
      <h1 className="text-lg font-semibold">Forecasts</h1>

      <nav className="flex gap-4 border-b border-gray-200 text-sm" aria-label="Forecast type">
        {TABS.map((t) => (
          <Link
            key={t.key}
            href={`/forecasts?tab=${t.key}${selected ? `&series=${formatSeriesKey(selected)}` : ""}`}
            className={
              tab === t.key
                ? "border-b-2 border-gray-900 pb-2 font-medium text-gray-900"
                : "pb-2 text-gray-500 hover:text-gray-700"
            }
          >
            {t.label}
          </Link>
        ))}
      </nav>

      {tab === "price" ? (
        // ponytail: tab shell only — T18 fills this in (F4-AC2/F4-ERR1).
        <p className="text-sm text-gray-500">Price forecasts land with T18.</p>
      ) : (
        <DemandTab seriesOptions={seriesOptions} selected={selected} />
      )}
    </main>
  );
}

async function DemandTab({
  seriesOptions,
  selected,
}: {
  seriesOptions: SeriesKey[];
  selected: SeriesKey | null;
}) {
  if (seriesOptions.length === 0 || !selected) {
    return (
      <p className="text-sm text-gray-500" data-testid="forecasts-empty">
        No material x plant series with consumption history yet.
      </p>
    );
  }

  const run = await getLatestDoneRun();

  return (
    <section className="space-y-4">
      <SeriesSelector options={seriesOptions} selected={selected} />

      {!run ? (
        <p className="text-sm text-gray-500" data-testid="forecasts-empty">
          No forecast run yet. Run a recompute from{" "}
          <Link href="/data" className="underline">
            /data
          </Link>
          .
        </p>
      ) : hasInsufficientHistoryWarning(run.warnings, selected) ? (
        // F3-ERR1. Code-complete; browser-verified with a synthetic
        // short-history case (real demo data has ≥26 weeks post-FIX-2, so this
        // path is exercised here via warnings.test.ts, not the seeded fixtures).
        <span
          data-testid="insufficient-chip"
          className="inline-block rounded-full bg-amber-100 px-3 py-1 text-xs font-medium text-amber-800"
        >
          Insufficient history for this series
        </span>
      ) : (
        <DemandSeriesView series={selected} runId={run.id} />
      )}
    </section>
  );
}

function SeriesSelector({
  options,
  selected,
}: {
  options: SeriesKey[];
  selected: SeriesKey;
}) {
  return (
    <div className="flex flex-wrap gap-2 text-sm" data-testid="series-selector">
      {options.map((opt) => {
        const key = formatSeriesKey(opt);
        const isActive = seriesEquals(opt, selected);
        return (
          <Link
            key={key}
            href={`/forecasts?tab=demand&series=${key}`}
            aria-current={isActive ? "true" : undefined}
            className={
              isActive
                ? "rounded-full bg-gray-900 px-3 py-1 text-white"
                : "rounded-full border border-gray-300 px-3 py-1 text-gray-700 hover:bg-gray-50"
            }
          >
            {key}
          </Link>
        );
      })}
    </div>
  );
}

async function DemandSeriesView({ series, runId }: { series: SeriesKey; runId: string }) {
  const data = await getDemandSeriesData(series, runId);

  if (!data) {
    return (
      <p className="text-sm text-gray-500" data-testid="forecasts-empty">
        No data for this series.
      </p>
    );
  }

  // Merge history + forecast onto one week axis for the chart (distinct series
  // per PRD F3-AC2 — history weeks carry `actual`, forecast weeks carry `forecast`,
  // and the two never overlap so each row only ever fills one of the two keys).
  const byWeek = new Map<string, { actual: number | null; forecast: number | null }>();
  for (const p of data.history) {
    byWeek.set(p.week, { actual: p.qtyMt, forecast: null });
  }
  for (const p of data.forecast) {
    byWeek.set(p.week, { actual: byWeek.get(p.week)?.actual ?? null, forecast: p.qtyMt });
  }
  const chartData = [...byWeek.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([week, v]) => ({ week, ...v }));

  return (
    <div className="space-y-4">
      {data.model && data.backtestWape !== null ? (
        <span
          data-testid="wape-badge"
          className="inline-block rounded-full bg-gray-100 px-3 py-1 text-xs font-medium text-gray-700"
        >
          {data.model} · WAPE {(data.backtestWape * 100).toFixed(1)}%
        </span>
      ) : null}

      <DemandChart data={chartData} />

      {/* PRD §11 accessibility: text equivalent of the chart via a native
          disclosure widget — no JS required, works before hydration. */}
      <details>
        <summary className="cursor-pointer text-sm text-gray-600">
          View data table (text equivalent of the chart)
        </summary>
        <table
          data-testid="forecast-table"
          className="mt-2 w-full border-collapse text-left text-xs"
        >
          <thead>
            <tr className="border-b border-gray-200 text-gray-500">
              <th className="py-1 pr-4 font-medium">Week</th>
              <th className="py-1 pr-4 font-medium">Type</th>
              <th className="py-1 font-medium">Qty (MT)</th>
            </tr>
          </thead>
          <tbody>
            {data.history.map((p) => (
              <tr key={`h-${p.week}`} className="border-b border-gray-100">
                <td className="py-1 pr-4">{p.week}</td>
                <td className="py-1 pr-4">Actual</td>
                <td className="py-1">{formatQtyMt(p.qtyMt)}</td>
              </tr>
            ))}
            {data.forecast.map((p) => (
              <tr key={`f-${p.week}`} className="border-b border-gray-100">
                <td className="py-1 pr-4">{p.week}</td>
                <td className="py-1 pr-4">Forecast</td>
                <td className="py-1">{formatQtyMt(p.qtyMt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </div>
  );
}
