import { formatPriceInrMt, formatQtyMt } from "@/app/forecasts/format";
import { getLatestDoneRun } from "@/app/forecasts/queries";
import { playChipClass, playChipLabel } from "@/app/recommendations/chips";
import { ValueChart } from "@/components/charts/value-chart";
import { auth } from "@/auth";
import { CAPABILITIES } from "@/auth/access";
import { computeValueReport, type DecisionValueRow, type ValueRowState } from "@/lib/value/value";

import { formatMoneyInr, formatPct } from "./format";
import { MemoPanel } from "./memo-panel";
import { getDemandQuality, getLatestMemo, getPriceQuality } from "./queries";

// Baseline formula text — PRD §6 F8 "documented on the report page" and PRD §13
// Glossary "Baseline". Must render even in the F8-ERR1 empty state, so it's a
// standalone component rather than nested inside the decisions section.
const BASELINE_FORMULA =
  "Baseline = decision-month average committed market price × decided quantity";

const STATE_BADGE_CLASS: Record<ValueRowState, string> = {
  ESTIMATED: "bg-surface-alt text-muted",
  ACTUALIZED: "bg-positive-surface text-positive",
  BASELINE_UNAVAILABLE: "bg-warn-surface text-warn",
};

function formatDecidedAt(iso: string): string {
  return new Date(iso).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" });
}

// `/reports/pilot` (F8). Server component: value report + forecast-quality data
// fetched directly via db, matching the /forecasts and /recommendations
// server-component pattern — no client fetch, no /api route needed for this
// page's own render (task card point 1, simplicity bias per PRD §0).
export default async function PilotReportPage() {
  const [report, run, session, latestMemo] = await Promise.all([
    computeValueReport(),
    getLatestDoneRun(),
    auth(),
    getLatestMemo(),
  ]);
  const [demandQuality, priceQuality] = run
    ? await Promise.all([getDemandQuality(run.id), getPriceQuality(run.id)])
    : [[], []];

  const hasDecisions = report.decisions.length > 0;
  const canGenerateMemo =
    !!session?.user?.role &&
    (CAPABILITIES.MUTATE_DATA as readonly string[]).includes(session.user.role);

  return (
    <main className="mx-auto max-w-4xl space-y-6 p-8">
      <div>
        <h1 className="text-lg font-semibold">Pilot report</h1>
        <p className="text-sm text-muted">
          Every decision measured against the market baseline — what the pilot has saved so far.
        </p>
      </div>

      <p className="text-sm text-muted" data-testid="baseline-formula">
        {BASELINE_FORMULA}
      </p>

      <AdoptionStats summary={report.summary} />

      {hasDecisions ? (
        <>
          <section className="space-y-2">
            <h2 className="text-sm font-medium text-muted">Cumulative value</h2>
            <ValueChart data={report.cumulative} />
            <ValueTableFallback cumulative={report.cumulative} />
          </section>

          <section className="space-y-2">
            <h2 className="text-sm font-medium text-muted">Decisions</h2>
            <DecisionsTable rows={report.decisions} />
          </section>
        </>
      ) : (
        // F8-ERR1: explicit empty state; the baseline formula above still renders,
        // and the chart is never mounted against zero rows (empty-safe).
        <p className="text-sm text-muted" data-testid="reports-empty">
          No decisions in period.
        </p>
      )}

      <ForecastQualityPanel demandQuality={demandQuality} priceQuality={priceQuality} hasRun={!!run} />

      <MemoPanel initialMemo={latestMemo} canGenerate={canGenerateMemo} />
    </main>
  );
}

function AdoptionStats({ summary }: { summary: Awaited<ReturnType<typeof computeValueReport>>["summary"] }) {
  return (
    <section
      className="flex flex-wrap gap-6 rounded-xl border border-border bg-surface p-4 text-sm"
      data-testid="adoption-stats"
    >
      <div>
        <p className="text-xs text-muted">Total value</p>
        <p className="font-medium">{formatMoneyInr(summary.totalValueInr)}</p>
      </div>
      <div>
        <p className="text-xs text-muted">Decisions</p>
        <p className="font-medium">
          {summary.decidedCount} of {summary.totalRecommendations}
        </p>
      </div>
      <div>
        <p className="text-xs text-muted">Adoption</p>
        <p className="font-medium">{formatPct(summary.adoptionPct, 1)}</p>
      </div>
    </section>
  );
}

function ValueTableFallback({
  cumulative,
}: {
  cumulative: { decidedAt: string; cumulativeValueInr: number }[];
}) {
  return (
    // PRD §11 accessibility: text equivalent of the chart via a native
    // disclosure widget — same pattern as /forecasts (no JS required).
    <details>
      <summary className="cursor-pointer text-sm text-muted">
        View data table (text equivalent of the chart)
      </summary>
      <table className="mt-2 w-full border-collapse text-left text-xs">
        <thead>
          <tr className="border-b border-border text-[11px] font-semibold uppercase tracking-wide text-muted">
            <th className="py-1 pr-4 font-medium">Decided at</th>
            <th className="py-1 font-medium">Cumulative value</th>
          </tr>
        </thead>
        <tbody>
          {cumulative.map((c, i) => (
            <tr key={`${c.decidedAt}-${i}`} className="border-b border-border hover:bg-surface-alt">
              <td className="py-1 pr-4">{formatDecidedAt(c.decidedAt)}</td>
              <td className="py-1">{formatMoneyInr(c.cumulativeValueInr)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </details>
  );
}

function DecisionsTable({ rows }: { rows: DecisionValueRow[] }) {
  return (
    <table data-testid="decisions-table" className="w-full border-collapse text-left text-sm">
      <thead>
        <tr className="border-b border-border text-[11px] font-semibold uppercase tracking-wide text-muted">
          <th className="py-2 pr-4 font-medium">Material · Plant</th>
          <th className="py-2 pr-4 font-medium">System play</th>
          <th className="py-2 pr-4 font-medium">Human action</th>
          <th className="py-2 pr-4 font-medium">Decided at</th>
          <th className="py-2 pr-4 font-medium">Qty (MT)</th>
          <th className="py-2 pr-4 font-medium">Baseline (₹/MT)</th>
          <th className="py-2 pr-4 font-medium">Plan cost</th>
          <th className="py-2 pr-4 font-medium">Value</th>
          <th className="py-2 font-medium">State</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.recommendationId} className="border-b border-border hover:bg-surface-alt">
            <td className="py-2 pr-4">
              {row.materialCode} · {row.plantCode}
            </td>
            <td className="py-2 pr-4">
              <span
                className={`inline-block rounded-full px-3 py-1 text-xs font-medium ${playChipClass(row.systemPlay)}`}
              >
                {playChipLabel(row.systemPlay)}
              </span>
            </td>
            <td className="py-2 pr-4">
              {row.humanAction}
              {row.overridePlay ? ` → ${row.overridePlay}` : ""}
            </td>
            <td className="py-2 pr-4">{formatDecidedAt(row.decidedAt)}</td>
            <td className="py-2 pr-4">{formatQtyMt(row.qtyMt)}</td>
            <td className="py-2 pr-4">{formatPriceInrMt(row.baselineInrMt)}</td>
            <td className="py-2 pr-4">{formatMoneyInr(row.planCostInr)}</td>
            <td className="py-2 pr-4">{formatMoneyInr(row.valueInr)}</td>
            <td className="py-2">
              <span
                className={`inline-block rounded-full px-3 py-1 text-xs font-medium ${STATE_BADGE_CLASS[row.state]}`}
              >
                {row.state}
              </span>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function ForecastQualityPanel({
  demandQuality,
  priceQuality,
  hasRun,
}: {
  demandQuality: Awaited<ReturnType<typeof getDemandQuality>>;
  priceQuality: Awaited<ReturnType<typeof getPriceQuality>>;
  hasRun: boolean;
}) {
  return (
    <section className="space-y-3" data-testid="quality-panel">
      <h2 className="text-sm font-medium text-muted">Forecast quality</h2>

      {!hasRun ? (
        <p className="text-sm text-muted">No forecast run yet.</p>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <p className="mb-1 text-xs font-medium text-muted">Demand WAPE (per series)</p>
            {demandQuality.length === 0 ? (
              <p className="text-sm text-muted">No series forecast yet.</p>
            ) : (
              <ul className="space-y-1 text-sm">
                {demandQuality.map((q) => (
                  <li key={`${q.materialCode}-${q.plantCode}`}>
                    {q.materialCode} · {q.plantCode} — {q.model} · WAPE{" "}
                    {formatPct(q.backtestWape * 100, 1)}
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div>
            <p className="mb-1 text-xs font-medium text-muted">
              Price decision band coverage (4w)
            </p>
            {priceQuality.length === 0 ? (
              <p className="text-sm text-muted">No price band forecast yet.</p>
            ) : (
              <ul className="space-y-1 text-sm">
                {priceQuality.map((q) => (
                  <li key={q.gradeFamily}>
                    {q.gradeFamily} — {formatPct(q.coverage8090 !== null ? q.coverage8090 * 100 : null, 0)}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
