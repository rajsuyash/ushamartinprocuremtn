import Link from "next/link";
import { notFound } from "next/navigation";

import { formatPriceInrMt, formatQtyMt } from "@/app/forecasts/format";
import type { RecommendationRationale } from "@/app/tile-logic";

import { playChipClass, playChipLabel, statusChipClass } from "../chips";
import { formatImpactInr } from "../format";
import { computeImpactBarLayout } from "../impact-bar";
import { getRecommendationDetail, type ExpectedImpact, type OrderLine } from "../queries";

import { DecisionBar } from "./decision-bar";

interface RecommendationDetailPageProps {
  params: Promise<{ id: string }>;
}

function formatDateTime(date: Date): string {
  return date.toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" });
}

// `/recommendations/:id` (F6 detail). Renders ENTIRELY from the stored E13 row —
// rationale/orderLines/expectedImpact are never recomputed client- or server-side
// (known pitfall: the audit view must never drift from what was decided on).
export default async function RecommendationDetailPage({
  params,
}: RecommendationDetailPageProps) {
  const { id } = await params;
  const rec = await getRecommendationDetail(id);
  if (!rec) notFound();

  const isError = !!rec.rationale.error;

  return (
    <main className="mx-auto max-w-4xl space-y-6 p-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-sm text-gray-500">
            <Link href="/recommendations" className="underline">
              Recommendations
            </Link>
          </p>
          <h1 className="text-lg font-semibold">
            {rec.materialCode} · {rec.plantCode}
          </h1>
        </div>
        <div className="flex items-center gap-2">
          <span
            className={`inline-block rounded-full px-3 py-1 text-xs font-medium ${playChipClass(rec.play)}`}
          >
            {playChipLabel(rec.play)}
          </span>
          <span
            data-testid="status-chip"
            className={`inline-block rounded-full px-3 py-1 text-xs font-medium ${statusChipClass(rec.status)}`}
          >
            {rec.status}
          </span>
        </div>
      </div>

      {isError ? (
        <ErrorPanel rationale={rec.rationale} />
      ) : (
        <>
          <RationalePanel rationale={rec.rationale} />
          {rec.expectedImpact ? <ExpectedImpactPanel impact={rec.expectedImpact} /> : null}
          <OrderLinesTable orderLines={rec.orderLines} />
        </>
      )}

      <section data-testid="decision-bar-slot" aria-label="Decision actions">
        <DecisionBar recommendationId={rec.id} status={rec.status} play={rec.play} />
      </section>

      {rec.decision ? (
        <>
          {rec.decision.override ? (
            <section className="flex items-center gap-4 text-sm" data-testid="override-comparison">
              <span>
                System play: <strong>{rec.play}</strong>
              </span>
              <span aria-hidden="true">→</span>
              <span>
                Human play: <strong>{rec.decision.override.play}</strong>
              </span>
            </section>
          ) : null}
          <p className="text-sm text-gray-600" data-testid="audit-line">
            {rec.decision.action} by {rec.decision.decidedByEmail} at{" "}
            {formatDateTime(rec.decision.decidedAt)}
            {rec.decision.note ? ` — "${rec.decision.note}"` : ""}
          </p>
        </>
      ) : null}
    </main>
  );
}

function ErrorPanel({ rationale }: { rationale: RecommendationRationale }) {
  const error = rationale.error;
  if (!error) return null;
  return (
    <section
      data-testid="rationale-panel"
      className="space-y-2 rounded border border-red-200 bg-red-50 p-4 text-sm"
    >
      <p className="font-medium text-red-800">Error: {error.code}</p>
      {Array.isArray(error.bindingConstraints) && error.bindingConstraints.length > 0 ? (
        <div>
          <p className="text-xs font-medium text-red-700">Binding constraints</p>
          <ul className="list-inside list-disc text-red-700">
            {(error.bindingConstraints as string[]).map((c) => (
              <li key={c}>{c}</li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}

function RationalePanel({ rationale }: { rationale: RecommendationRationale }) {
  const inputs = rationale.inputs;
  if (!inputs) {
    return (
      <p className="text-sm text-gray-500" data-testid="rationale-panel">
        No rationale recorded for this recommendation.
      </p>
    );
  }
  const drivers = rationale.drivers ?? [];
  const constraintsRespected = rationale.constraintsRespected ?? [];

  return (
    <section data-testid="rationale-panel" className="space-y-4 rounded border border-gray-200 p-4">
      <div className="grid grid-cols-2 gap-4 text-sm sm:grid-cols-3">
        <div>
          <p className="text-xs text-gray-500">Cover vs floor</p>
          <p className="font-medium">
            {inputs.coverDays}d vs {inputs.minCoverDays}d
          </p>
        </div>
        <div>
          <p className="text-xs text-gray-500">Spot (₹/MT)</p>
          <p className="font-medium">{formatPriceInrMt(inputs.spotInrMt)}</p>
        </div>
        <div>
          <p className="text-xs text-gray-500">4w band (P10 / P50 / P90)</p>
          <p className="font-medium">
            {formatPriceInrMt(inputs.band4w.p10)} / {formatPriceInrMt(inputs.band4w.p50)} /{" "}
            {formatPriceInrMt(inputs.band4w.p90)}
          </p>
        </div>
      </div>

      <div>
        <p className="mb-1 text-xs font-medium text-gray-500">Supplier spread (₹/MT)</p>
        <table
          data-testid="spread-table"
          className="w-full max-w-sm border-collapse text-left text-xs"
        >
          <tbody>
            {Object.entries(inputs.spread).map(([supplier, price]) => (
              <tr key={supplier} className="border-b border-gray-100">
                <td className="py-1 pr-4">{supplier}</td>
                <td className="py-1">{formatPriceInrMt(price)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div>
        <p className="mb-1 text-xs font-medium text-gray-500">Drivers</p>
        {drivers.length === 0 ? (
          <p className="text-sm text-gray-400">No drivers recorded.</p>
        ) : (
          <ul className="space-y-1 text-sm">
            {drivers.map((d) => (
              <li key={d.factor}>
                <span className="font-medium">{d.factor}</span> — {d.detail}
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="flex flex-wrap gap-2" data-testid="constraint-chips">
        {constraintsRespected.map((c) => (
          <span
            key={c}
            className="inline-block rounded-full bg-gray-100 px-3 py-1 text-xs font-medium text-gray-700"
          >
            {c}
          </span>
        ))}
      </div>
    </section>
  );
}

function ExpectedImpactPanel({ impact }: { impact: ExpectedImpact }) {
  const layout = computeImpactBarLayout(
    impact.costDeltaP10Inr,
    impact.costDeltaInr,
    impact.costDeltaP90Inr,
  );

  return (
    <section
      data-testid="expected-impact"
      className="space-y-3 rounded border border-gray-200 p-4"
    >
      <p className="text-sm font-medium text-gray-700">Expected impact</p>

      <div className="relative h-2 rounded-full bg-gray-100">
        <div
          className="absolute h-2 rounded-full bg-blue-200"
          style={{
            left: `${Math.min(layout.p10Pct, layout.p90Pct)}%`,
            width: `${Math.abs(layout.p90Pct - layout.p10Pct)}%`,
          }}
        />
        <div
          className="absolute top-1/2 h-3 w-0.5 -translate-y-1/2 bg-gray-400"
          style={{ left: `${layout.zeroPct}%` }}
          aria-hidden
        />
        <div
          className="absolute top-1/2 h-3 w-1 -translate-y-1/2 rounded bg-blue-700"
          style={{ left: `${layout.p50Pct}%` }}
          aria-hidden
        />
      </div>

      <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-3">
        <div>
          <dt className="text-xs text-gray-500">Cost Δ (P10 / P50 / P90)</dt>
          <dd className="font-medium">
            {formatImpactInr(impact.costDeltaP10Inr)} / {formatImpactInr(impact.costDeltaInr)} /{" "}
            {formatImpactInr(impact.costDeltaP90Inr)}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-gray-500">Working capital Δ</dt>
          <dd className="font-medium">{formatImpactInr(impact.wcDeltaInr)}</dd>
        </div>
        <div>
          <dt className="text-xs text-gray-500">Cover after</dt>
          <dd className="font-medium">{impact.coverAfterDays}d</dd>
        </div>
      </dl>
    </section>
  );
}

function OrderLinesTable({ orderLines }: { orderLines: OrderLine[] }) {
  if (orderLines.length === 0) {
    return (
      <p className="text-sm text-gray-500" data-testid="order-lines-empty">
        No order lines (this play carries no purchase, e.g. WAIT / HEDGE_LOCK).
      </p>
    );
  }
  return (
    <table data-testid="order-lines-table" className="w-full border-collapse text-left text-sm">
      <thead>
        <tr className="border-b border-gray-200 text-gray-500">
          <th className="py-2 pr-4 font-medium">Supplier</th>
          <th className="py-2 pr-4 font-medium">Qty (MT)</th>
          <th className="py-2 pr-4 font-medium">Target week</th>
          <th className="py-2 font-medium">Est. price (₹/MT)</th>
        </tr>
      </thead>
      <tbody>
        {orderLines.map((line, i) => (
          <tr key={`${line.supplierCode}-${i}`} className="border-b border-gray-100">
            <td className="py-2 pr-4">{line.supplierCode}</td>
            <td className="py-2 pr-4">{formatQtyMt(line.qtyMt)}</td>
            <td className="py-2 pr-4">{line.targetWeek}</td>
            <td className="py-2">{formatPriceInrMt(line.estPriceInrMt)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
