import Link from "next/link";

import { DemandChart } from "@/components/charts/demand-chart";
import { PriceBandChart } from "@/components/charts/price-band-chart";

import { formatPriceInrMt, formatQtyMt } from "./format";
import {
  getDemandSeriesData,
  getGradeFamilyOptions,
  getLatestDoneRun,
  getPriceSeriesData,
  getSeriesOptions,
} from "./queries";
import { formatSeriesKey, parseSeriesParam, seriesEquals, type SeriesKey } from "./series";
import {
  hasBaselineFallbackWarning,
  hasInsufficientHistoryWarning,
  type RunWarning,
} from "./warnings";

interface ForecastsPageProps {
  searchParams: Promise<{ tab?: string; series?: string; grade?: string }>;
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

  const gradeOptions = await getGradeFamilyOptions();
  const selectedGrade =
    (params.grade && gradeOptions.includes(params.grade) ? params.grade : null) ??
    gradeOptions[0] ??
    null;

  const tabHref = (tabKey: (typeof TABS)[number]["key"]) => {
    if (tabKey === "price") {
      return `/forecasts?tab=price${selectedGrade ? `&grade=${selectedGrade}` : ""}`;
    }
    return `/forecasts?tab=demand${selected ? `&series=${formatSeriesKey(selected)}` : ""}`;
  };

  return (
    <main className="mx-auto max-w-4xl space-y-6 p-8">
      <div>
        <h1 className="text-lg font-semibold">Forecasts</h1>
        <p className="text-sm text-muted">
          Expected demand and the likely market price range for the weeks ahead.
        </p>
      </div>

      <nav className="flex gap-4 border-b border-border text-sm" aria-label="Forecast type">
        {TABS.map((t) => (
          <Link
            key={t.key}
            href={tabHref(t.key)}
            className={
              tab === t.key
                ? "border-b-2 border-primary pb-2 font-medium text-ink"
                : "pb-2 text-muted hover:text-muted"
            }
          >
            {t.label}
          </Link>
        ))}
      </nav>

      {tab === "price" ? (
        <PriceTab gradeOptions={gradeOptions} selectedGrade={selectedGrade} />
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
      <p className="text-sm text-muted" data-testid="forecasts-empty">
        No material x plant series with consumption history yet.
      </p>
    );
  }

  const run = await getLatestDoneRun();

  return (
    <section className="space-y-4">
      <SeriesSelector options={seriesOptions} selected={selected} />

      {!run ? (
        <p className="text-sm text-muted" data-testid="forecasts-empty">
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
          className="inline-block rounded-full bg-warn-surface px-3 py-1 text-xs font-medium text-warn"
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
                ? "rounded-full bg-primary px-3 py-1 text-white"
                : "rounded-full border border-border px-3 py-1 text-muted hover:bg-surface-alt"
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
      <p className="text-sm text-muted" data-testid="forecasts-empty">
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
          className="inline-block rounded-full bg-surface-alt px-3 py-1 text-xs font-medium text-muted"
        >
          {data.model} · WAPE {(data.backtestWape * 100).toFixed(1)}%
        </span>
      ) : null}

      <DemandChart data={chartData} />

      {/* PRD §11 accessibility: text equivalent of the chart via a native
          disclosure widget — no JS required, works before hydration. */}
      <details>
        <summary className="cursor-pointer text-sm text-muted">
          View data table (text equivalent of the chart)
        </summary>
        <table
          data-testid="forecast-table"
          className="mt-2 w-full border-collapse text-left text-xs"
        >
          <thead>
            <tr className="border-b border-border text-[11px] font-semibold uppercase tracking-wide text-muted">
              <th className="py-1 pr-4 font-medium">Week</th>
              <th className="py-1 pr-4 font-medium">Type</th>
              <th className="py-1 font-medium">Qty (MT)</th>
            </tr>
          </thead>
          <tbody>
            {data.history.map((p) => (
              <tr key={`h-${p.week}`} className="border-b border-border hover:bg-surface-alt">
                <td className="py-1 pr-4">{p.week}</td>
                <td className="py-1 pr-4">Actual</td>
                <td className="py-1">{formatQtyMt(p.qtyMt)}</td>
              </tr>
            ))}
            {data.forecast.map((p) => (
              <tr key={`f-${p.week}`} className="border-b border-border hover:bg-surface-alt">
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

// The 4-week horizon is the canonical one referenced elsewhere (PRD F5 rationale
// example uses `band4w`) — the coverage badge shows this horizon's backtest
// coverage rather than trying to summarize all three at once.
const COVERAGE_BADGE_HORIZON_WEEKS = 4;

async function PriceTab({
  gradeOptions,
  selectedGrade,
}: {
  gradeOptions: string[];
  selectedGrade: string | null;
}) {
  if (gradeOptions.length === 0 || !selectedGrade) {
    return (
      <p className="text-sm text-muted" data-testid="forecasts-empty">
        No grade families with market price history yet.
      </p>
    );
  }

  const run = await getLatestDoneRun();

  return (
    <section className="space-y-4">
      <GradeFamilySelector options={gradeOptions} selected={selectedGrade} />

      {!run ? (
        <p className="text-sm text-muted" data-testid="forecasts-empty">
          No forecast run yet. Run a recompute from{" "}
          <Link href="/data" className="underline">
            /data
          </Link>
          .
        </p>
      ) : (
        <PriceSeriesView gradeFamily={selectedGrade} runId={run.id} runWarnings={run.warnings} />
      )}
    </section>
  );
}

function GradeFamilySelector({
  options,
  selected,
}: {
  options: string[];
  selected: string;
}) {
  return (
    <div className="flex flex-wrap gap-2 text-sm" data-testid="grade-family-selector">
      {options.map((grade) => {
        const isActive = grade === selected;
        return (
          <Link
            key={grade}
            href={`/forecasts?tab=price&grade=${grade}`}
            aria-current={isActive ? "true" : undefined}
            className={
              isActive
                ? "rounded-full bg-primary px-3 py-1 text-white"
                : "rounded-full border border-border px-3 py-1 text-muted hover:bg-surface-alt"
            }
          >
            {grade}
          </Link>
        );
      })}
    </div>
  );
}

async function PriceSeriesView({
  gradeFamily,
  runId,
  runWarnings,
}: {
  gradeFamily: string;
  runId: string;
  runWarnings: RunWarning[];
}) {
  const data = await getPriceSeriesData(gradeFamily, runId);

  if (!data) {
    return (
      <p className="text-sm text-muted" data-testid="forecasts-empty">
        No data for this grade family.
      </p>
    );
  }

  // Merge history + the 3 horizon points onto one week axis for the chart
  // (F4-AC2) — history weeks carry `price`, the 3 forecast horizons carry
  // p10/p50/p90, and the two never overlap (bands are anchored after history end).
  const byWeek = new Map<
    string,
    { price: number | null; p10: number | null; p50: number | null; p90: number | null }
  >();
  for (const p of data.history) {
    byWeek.set(p.week, { price: p.priceInrMt, p10: null, p50: null, p90: null });
  }
  for (const b of data.bands) {
    byWeek.set(b.week, {
      price: byWeek.get(b.week)?.price ?? null,
      p10: b.p10InrMt,
      p50: b.p50InrMt,
      p90: b.p90InrMt,
    });
  }
  const chartData = [...byWeek.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([week, v]) => ({ week, ...v }));

  const coverageBand = data.bands.find((b) => b.horizonWeeks === COVERAGE_BADGE_HORIZON_WEEKS);
  const isBaselineFallback = hasBaselineFallbackWarning(runWarnings, gradeFamily);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        {coverageBand && coverageBand.coverage8090 !== null ? (
          <span
            data-testid="coverage-badge"
            className="inline-block rounded-full bg-surface-alt px-3 py-1 text-xs font-medium text-muted"
          >
            decision band · {(coverageBand.coverage8090 * 100).toFixed(0)}% coverage (4w)
          </span>
        ) : null}

        {isBaselineFallback ? (
          // F4-ERR1: band still renders (random-walk baseline) — the chip flags
          // reduced model quality rather than hiding or silently pretending.
          <span
            data-testid="baseline-fallback-chip"
            className="inline-block rounded-full bg-warn-surface px-3 py-1 text-xs font-medium text-warn"
          >
            Baseline fallback (limited price history)
          </span>
        ) : null}
      </div>

      <PriceBandChart data={chartData} />

      {/* PRD §11 accessibility: text equivalent of the chart via a native
          disclosure widget — no JS required, works before hydration. */}
      <details>
        <summary className="cursor-pointer text-sm text-muted">
          View data table (text equivalent of the chart)
        </summary>
        <table
          data-testid="price-band-table"
          className="mt-2 w-full border-collapse text-left text-xs"
        >
          <thead>
            <tr className="border-b border-border text-[11px] font-semibold uppercase tracking-wide text-muted">
              <th className="py-1 pr-4 font-medium">Week</th>
              <th className="py-1 pr-4 font-medium">Type</th>
              <th className="py-1 pr-4 font-medium">P10 (₹/MT)</th>
              <th className="py-1 pr-4 font-medium">P50 (₹/MT)</th>
              <th className="py-1 font-medium">P90 (₹/MT)</th>
            </tr>
          </thead>
          <tbody>
            {data.history.map((p) => (
              <tr key={`h-${p.week}`} className="border-b border-border hover:bg-surface-alt">
                <td className="py-1 pr-4">{p.week}</td>
                <td className="py-1 pr-4">Market price</td>
                <td className="py-1 pr-4">{formatPriceInrMt(null)}</td>
                <td className="py-1 pr-4">{formatPriceInrMt(p.priceInrMt)}</td>
                <td className="py-1">{formatPriceInrMt(null)}</td>
              </tr>
            ))}
            {data.bands.map((b) => (
              <tr key={`b-${b.week}`} className="border-b border-border hover:bg-surface-alt">
                <td className="py-1 pr-4">{b.week}</td>
                <td className="py-1 pr-4">Forecast ({b.horizonWeeks}w)</td>
                <td className="py-1 pr-4">{formatPriceInrMt(b.p10InrMt)}</td>
                <td className="py-1 pr-4">{formatPriceInrMt(b.p50InrMt)}</td>
                <td className="py-1">{formatPriceInrMt(b.p90InrMt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </div>
  );
}
