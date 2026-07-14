"use client";

import { useState } from "react";
import Link from "next/link";
import type { Envelope, SimulateResult, SimulatedPlan } from "@pdi/shared";

import { KpiCard } from "@/components/kpi-card";

import { formatPriceInrMt, formatQtyMt } from "../forecasts/format";

export interface SeriesOption {
  materialCode: string;
  plantCode: string;
  recommendationId: string;
}

export interface PolicyDefaults {
  minCoverDays: number;
  maxSupplierSharePct: number;
  wcCapInr: number | null;
}

interface SimulatorPanelProps {
  series: SeriesOption[];
  policyDefaults: PolicyDefaults;
  isViewer: boolean;
  showPolicyLink: boolean;
}

const LEAD_BUFFER_OPTIONS = [
  { value: -3, label: "Aggressive (−3 days)" },
  { value: 0, label: "Standard (as quoted)" },
  { value: 7, label: "Conservative (+7 days)" },
] as const;

const INPUT_CLASS =
  "w-full rounded border border-border bg-surface px-2 py-1.5 text-sm text-ink focus:outline-none focus:ring-1 focus:ring-primary";
const LABEL_CLASS = "text-xs font-semibold uppercase tracking-wider text-muted";

function seriesKey(s: SeriesOption): string {
  return `${s.materialCode}·${s.plantCode}`;
}

// PRD §14 (resolved): pilot series = WR-5.5-HC · RNC — preselect it when present
// instead of the alphabetically-first series.
const PILOT_SERIES_KEY = "WR-5.5-HC·RNC";

function defaultSeriesKey(series: SeriesOption[]): string {
  if (series.some((s) => seriesKey(s) === PILOT_SERIES_KEY)) return PILOT_SERIES_KEY;
  return series[0] ? seriesKey(series[0]) : "";
}

/** Signed ₹ display for cost deltas: negative = savings vs just-in-time buying. */
function formatCostDelta(inr: number): string {
  const abs = formatPriceInrMt(Math.abs(inr));
  return inr < 0 ? `−₹${abs}` : inr > 0 ? `+₹${abs}` : "₹0";
}

function totalQtyMt(plan: SimulatedPlan): number {
  return plan.orderLines.reduce((sum, l) => sum + l.qtyMt, 0);
}

function topSupplier(plan: SimulatedPlan): string {
  if (plan.orderLines.length === 0) return "—";
  const bySupplier = new Map<string, number>();
  for (const l of plan.orderLines) {
    bySupplier.set(l.supplierCode, (bySupplier.get(l.supplierCode) ?? 0) + l.qtyMt);
  }
  const [code] = [...bySupplier.entries()].sort((a, b) => b[1] - a[1])[0];
  return code;
}

type RiskLevel = { label: string; detail: string; risk: boolean };

function deriveRisk(result: SimulateResult): RiskLevel {
  const sim = result.simulated;
  if (sim.status === "ERROR") {
    return { label: "Infeasible", detail: sim.error?.code ?? "No feasible plan", risk: true };
  }
  if (sim.constraintCheck && !sim.constraintCheck.ok) {
    const n = sim.constraintCheck.coverViolations.length + sim.constraintCheck.shareViolations.length;
    return { label: "Elevated", detail: `${n} constraint violation${n === 1 ? "" : "s"}`, risk: true };
  }
  const coverAfter = sim.expectedImpact?.coverAfterDays;
  if (coverAfter !== undefined && coverAfter < result.policy.minCoverDays) {
    return {
      label: "Elevated",
      detail: `Cover ${coverAfter.toFixed(1)}d below ${result.policy.minCoverDays}d floor`,
      risk: true,
    };
  }
  return { label: "Within policy", detail: "All constraints respected", risk: false };
}

interface RationaleDriver {
  factor: string;
  detail: string;
}

function drivers(plan: SimulatedPlan): RationaleDriver[] {
  const raw = plan.rationale?.drivers;
  if (!Array.isArray(raw)) return [];
  return raw.filter(
    (d): d is RationaleDriver =>
      !!d && typeof d === "object" && "factor" in d && "detail" in d,
  );
}

export function SimulatorPanel({
  series,
  policyDefaults,
  isViewer,
  showPolicyLink,
}: SimulatorPanelProps) {
  const [selected, setSelected] = useState(defaultSeriesKey(series));
  const [forcedQty, setForcedQty] = useState(0);
  const [leadBuffer, setLeadBuffer] = useState(0);
  const [priceShift, setPriceShift] = useState(0);
  const [minCover, setMinCover] = useState(policyDefaults.minCoverDays);
  const [maxShare, setMaxShare] = useState(policyDefaults.maxSupplierSharePct);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<SimulateResult | null>(null);

  const activeSeries = series.find((s) => seriesKey(s) === selected) ?? null;

  async function runSimulation(): Promise<void> {
    if (!activeSeries || running) return;
    setRunning(true);
    setError(null);
    try {
      const res = await fetch("/api/simulate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          materialCode: activeSeries.materialCode,
          plantCode: activeSeries.plantCode,
          overrides: {
            ...(forcedQty > 0 ? { forcedQtyMt: forcedQty } : {}),
            ...(leadBuffer !== 0 ? { leadTimeBufferDays: leadBuffer } : {}),
            ...(priceShift !== 0 ? { priceShiftPct: priceShift } : {}),
            ...(minCover !== policyDefaults.minCoverDays ? { minCoverDays: minCover } : {}),
            ...(maxShare !== policyDefaults.maxSupplierSharePct
              ? { maxSupplierSharePct: maxShare }
              : {}),
          },
        }),
      });
      const body = (await res.json()) as Envelope<SimulateResult>;
      if (!body.success) {
        setError(`${body.error.code}: ${body.error.message}`);
        return;
      }
      setResult(body.data);
    } catch {
      setError("Simulation request failed — try again.");
    } finally {
      setRunning(false);
    }
  }

  if (series.length === 0) {
    return (
      <p className="text-sm text-muted" data-testid="sandbox-empty">
        The latest run produced no recommendations to simulate against.
      </p>
    );
  }

  return (
    <div className="grid grid-cols-1 gap-5 xl:grid-cols-12" data-testid="sim-panel">
      {/* Parameter sidebar */}
      <aside className="xl:col-span-3">
        <div className="flex flex-col gap-5 rounded-xl border border-border bg-surface p-4">
          <h2 className="flex items-center gap-2 font-medium text-ink">
            <span className="material-symbols-outlined text-[20px]" aria-hidden="true">
              tune
            </span>
            Scenario parameters
          </h2>

          <label className="flex flex-col gap-1.5">
            <span className={LABEL_CLASS}>Series</span>
            <select
              className={INPUT_CLASS}
              value={selected}
              onChange={(e) => setSelected(e.target.value)}
            >
              {series.map((s) => (
                <option key={seriesKey(s)} value={seriesKey(s)}>
                  {s.materialCode} · {s.plantCode}
                </option>
              ))}
            </select>
          </label>

          <label className="flex flex-col gap-1.5">
            <span className={`${LABEL_CLASS} flex justify-between`}>
              Forced buy quantity
              <span className="normal-case text-ink">
                {forcedQty > 0 ? `${formatQtyMt(forcedQty)} MT` : "Optimizer decides"}
              </span>
            </span>
            <input
              type="range"
              min={0}
              max={5000}
              step={50}
              value={forcedQty}
              onChange={(e) => setForcedQty(Number(e.target.value))}
              className="h-2 w-full cursor-pointer accent-primary"
            />
            <span className="flex justify-between text-[10px] text-muted">
              <span>0 (optimal)</span>
              <span>5,000 MT</span>
            </span>
          </label>

          <label className="flex flex-col gap-1.5">
            <span className={LABEL_CLASS}>Lead time buffer</span>
            <select
              className={INPUT_CLASS}
              value={leadBuffer}
              onChange={(e) => setLeadBuffer(Number(e.target.value))}
            >
              {LEAD_BUFFER_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>

          <label className="flex flex-col gap-1.5">
            <span className={LABEL_CLASS}>Price outlook shift (%)</span>
            <input
              type="number"
              min={-20}
              max={20}
              step={1}
              value={priceShift}
              onChange={(e) => setPriceShift(Number(e.target.value))}
              className={INPUT_CLASS}
            />
          </label>

          <div className="flex flex-col gap-4 border-t border-border pt-4">
            <label className="flex flex-col gap-1.5">
              <span className={`${LABEL_CLASS} flex justify-between`}>
                Min cover floor
                <span className="normal-case text-ink">{minCover}d</span>
              </span>
              <input
                type="range"
                min={1}
                max={120}
                step={1}
                value={minCover}
                onChange={(e) => setMinCover(Number(e.target.value))}
                className="h-2 w-full cursor-pointer accent-primary"
              />
              <span className="text-[10px] text-muted">
                Policy default: {policyDefaults.minCoverDays}d
              </span>
            </label>

            <label className="flex flex-col gap-1.5">
              <span className={`${LABEL_CLASS} flex justify-between`}>
                Max supplier share
                <span className="normal-case text-ink">{maxShare}%</span>
              </span>
              <input
                type="range"
                min={10}
                max={100}
                step={5}
                value={maxShare}
                onChange={(e) => setMaxShare(Number(e.target.value))}
                className="h-2 w-full cursor-pointer accent-primary"
              />
              <span className="text-[10px] text-muted">
                Policy default: {policyDefaults.maxSupplierSharePct}%
              </span>
            </label>
          </div>

          {isViewer ? (
            <p className="text-xs text-muted">
              Simulations are available to buyers, approvers and admins.
            </p>
          ) : (
            <button
              type="button"
              data-testid="sim-run"
              onClick={() => void runSimulation()}
              disabled={running || !activeSeries}
              className="flex items-center justify-center gap-1 rounded bg-primary px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
            >
              <span className="material-symbols-outlined text-[18px]" aria-hidden="true">
                play_arrow
              </span>
              {running ? "Simulating…" : "Run simulation"}
            </button>
          )}

          {error ? (
            <p role="alert" className="text-xs text-risk">
              {error}
            </p>
          ) : null}
        </div>
      </aside>

      {/* Results */}
      <div className="flex flex-col gap-5 xl:col-span-9">
        {result ? (
          <Results result={result} activeSeries={activeSeries} showPolicyLink={showPolicyLink} />
        ) : (
          <div className="flex h-full min-h-48 items-center justify-center rounded-xl border border-dashed border-border p-8">
            <p className="text-sm text-muted">
              Set your parameters and run a simulation to compare against the system&apos;s plan.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

function Results({
  result,
  activeSeries,
  showPolicyLink,
}: {
  result: SimulateResult;
  activeSeries: SeriesOption | null;
  showPolicyLink: boolean;
}) {
  const { baseline, simulated, deltas } = result;
  const impact = simulated.expectedImpact;
  const risk = deriveRisk(result);
  const simDrivers = drivers(simulated);

  return (
    <>
      <section className="grid grid-cols-1 gap-5 md:grid-cols-3" data-testid="sim-kpis">
        <KpiCard
          label="Expected cost impact"
          value={impact ? formatCostDelta(impact.costDeltaInr) : "—"}
          context={
            impact
              ? `P10 ${formatCostDelta(impact.costDeltaP10Inr)} · P90 ${formatCostDelta(impact.costDeltaP90Inr)} vs buy-as-needed`
              : "No feasible plan"
          }
        />
        <KpiCard
          label="Cover after plan"
          value={impact ? `${impact.coverAfterDays.toFixed(1)}d` : "—"}
          context={`Floor: ${result.policy.minCoverDays}d`}
          risk={impact ? impact.coverAfterDays < result.policy.minCoverDays : false}
        />
        <KpiCard label="Supply risk" value={risk.label} context={risk.detail} risk={risk.risk} />
      </section>

      <section className="flex items-start gap-4 rounded-xl border border-border bg-surface-alt p-5">
        <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full bg-primary text-white">
          <span className="material-symbols-outlined text-[20px]" aria-hidden="true">
            precision_manufacturing
          </span>
        </div>
        <div className="space-y-2">
          <h2 className="font-medium text-ink">Prescriptive recommendation (simulated)</h2>
          <p className="text-xl font-semibold text-ink">
            {simulated.play ?? "No feasible plan"}
            {deltas?.playChanged ? (
              <span className="ml-2 rounded-full bg-warn-surface px-2 py-0.5 text-xs font-medium text-warn">
                changed from {baseline.play ?? "—"}
              </span>
            ) : null}
          </p>
          {simDrivers.length > 0 ? (
            <ul className="space-y-1 text-sm text-muted">
              {simDrivers.map((d) => (
                <li key={d.factor}>
                  <span className="font-medium text-ink">{d.factor}</span> — {d.detail}
                </li>
              ))}
            </ul>
          ) : null}
          <div className="flex flex-wrap gap-2 pt-1">
            {activeSeries ? (
              <Link
                href={`/recommendations/${activeSeries.recommendationId}`}
                className="rounded border border-border bg-surface px-3 py-1.5 text-xs font-medium text-ink hover:bg-surface-alt"
              >
                View live recommendation
              </Link>
            ) : null}
            {showPolicyLink ? (
              <Link
                href="/settings/policy"
                className="rounded border border-border bg-surface px-3 py-1.5 text-xs font-medium text-ink hover:bg-surface-alt"
              >
                Edit policy
              </Link>
            ) : null}
          </div>
          <p className="text-xs text-muted">
            Deterministic, rule-based reasoning — this simulation is not saved and cannot be
            approved. Decisions happen on real recommendations only.
          </p>
        </div>
      </section>

      <section
        className="overflow-hidden rounded-xl border border-border bg-surface"
        data-testid="sim-comparison"
      >
        <div className="border-b border-border px-4 py-3">
          <h2 className="font-medium text-ink">Baseline vs simulated</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-border bg-surface-alt text-xs uppercase tracking-wider text-muted">
                <th className="px-4 py-2 font-semibold">Metric</th>
                <th className="px-4 py-2 font-semibold">System plan (baseline)</th>
                <th className="px-4 py-2 font-semibold text-ink">Simulated plan</th>
                <th className="px-4 py-2 text-right font-semibold">Variance</th>
              </tr>
            </thead>
            <tbody>
              <ComparisonRow
                label="Play"
                baseline={baseline.play ?? "—"}
                simulated={simulated.play ?? "—"}
                variance={deltas?.playChanged ? "Changed" : "Same"}
              />
              <ComparisonRow
                label="Order quantity"
                baseline={`${formatQtyMt(totalQtyMt(baseline))} MT`}
                simulated={`${formatQtyMt(totalQtyMt(simulated))} MT`}
                variance={`${formatQtyMt(totalQtyMt(simulated) - totalQtyMt(baseline))} MT`}
              />
              <ComparisonRow
                label="Committed spend"
                baseline={baseline.expectedImpact ? `₹${formatPriceInrMt(baseline.expectedImpact.wcDeltaInr)}` : "—"}
                simulated={impact ? `₹${formatPriceInrMt(impact.wcDeltaInr)}` : "—"}
                variance={deltas ? formatCostDelta(deltas.wcDeltaInr) : "—"}
              />
              <ComparisonRow
                label="Cover after plan"
                baseline={
                  baseline.expectedImpact
                    ? `${baseline.expectedImpact.coverAfterDays.toFixed(1)}d`
                    : "—"
                }
                simulated={impact ? `${impact.coverAfterDays.toFixed(1)}d` : "—"}
                variance={deltas ? `${deltas.coverAfterDays > 0 ? "+" : ""}${deltas.coverAfterDays.toFixed(1)}d` : "—"}
              />
              <ComparisonRow
                label="Expected cost impact (P50)"
                baseline={
                  baseline.expectedImpact
                    ? formatCostDelta(baseline.expectedImpact.costDeltaInr)
                    : "—"
                }
                simulated={impact ? formatCostDelta(impact.costDeltaInr) : "—"}
                variance={deltas ? formatCostDelta(deltas.costDeltaInr) : "—"}
              />
              <ComparisonRow
                label="Primary supplier"
                baseline={topSupplier(baseline)}
                simulated={topSupplier(simulated)}
                variance={topSupplier(baseline) === topSupplier(simulated) ? "Same" : "Changed"}
              />
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}

function ComparisonRow({
  label,
  baseline,
  simulated,
  variance,
}: {
  label: string;
  baseline: string;
  simulated: string;
  variance: string;
}) {
  return (
    <tr className="border-b border-border last:border-b-0">
      <td className="px-4 py-2.5 text-muted">{label}</td>
      <td className="px-4 py-2.5 tabular-nums text-ink">{baseline}</td>
      <td className="bg-surface-alt px-4 py-2.5 font-medium tabular-nums text-ink">{simulated}</td>
      <td className="px-4 py-2.5 text-right tabular-nums text-muted">{variance}</td>
    </tr>
  );
}
