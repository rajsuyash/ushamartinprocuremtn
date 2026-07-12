import { cookies } from "next/headers";
import Link from "next/link";

import { getOpenAlertCount } from "@/app/alerts/queries";
import { getDatasetStatus } from "@/app/data/queries";
import { auth } from "@/auth";
import type { Role } from "@/auth/access";

import { dismissWelcomeAction } from "./actions";
import { formatPriceInrMt } from "./forecasts/format";
import {
  deriveGuidanceState,
  mapStateToStep,
  WELCOME_COOKIE_NAME,
  WORKFLOW_STEPS,
  type GuidanceState,
  type WorkflowStep,
} from "./guidance";
import { getDashboardTiles, getLatestDoneRun, type DashboardTile } from "./queries";
import { bestSupplierOffer, classifyBandDirection, isCoverBreach, type BandDirection } from "./tile-logic";

const DIRECTION_ARROW: Record<BandDirection, string> = {
  rising: "↑",
  falling: "↓",
  flat: "→",
};

function formatTimestamp(iso: string | null): string {
  if (!iso) return "never";
  return new Date(iso).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" });
}

/** Pulls the recommendation count out of the run's per-stage `counts` jsonb
 * (shape written by services/engine's recommend stage + the web orchestrator,
 * see lib/run-orchestrator.ts) — defensively, since it's untyped jsonb. */
function extractRecommendationCount(counts: Record<string, unknown>): number {
  const recommend = counts.recommend;
  if (recommend && typeof recommend === "object" && "recommendations" in recommend) {
    const n = (recommend as { recommendations: unknown }).recommendations;
    if (typeof n === "number") return n;
  }
  return 0;
}

// Dashboard `/` (F6-AC1). Server component: tiles, run banner, and alert-count
// slot are all fetched directly via db, matching the /forecasts and /data pages.
export default async function HomePage({
  searchParams,
}: {
  searchParams: Promise<{ denied?: string }>;
}) {
  const session = await auth();
  const { denied } = await searchParams;
  const user = session?.user;

  const run = await getLatestDoneRun();
  const tiles = run ? await getDashboardTiles(run.id) : [];
  const openAlertCount = await getOpenAlertCount();
  // Only queried when there's no run yet — a finished run already implies
  // committed data, so this avoids an extra query on the common path.
  const hasCommittedData = run
    ? true
    : (await getDatasetStatus()).some((s) => s.committedRows > 0);
  const pendingCount = tiles.filter((t) => t.status === "PENDING").length;

  const guidanceState = deriveGuidanceState({
    hasCommittedData,
    hasDoneRun: !!run,
    pendingCount,
    openAlertCount,
  });

  const cookieStore = await cookies();
  const welcomeDismissed = cookieStore.get(WELCOME_COOKIE_NAME)?.value === "1";

  return (
    <main className="mx-auto max-w-4xl space-y-6 p-8">
      {denied ? (
        <div
          role="alert"
          data-testid="denied-toast"
          className="rounded border border-amber-300 bg-amber-50 px-4 py-2 text-sm text-amber-800"
        >
          Not permitted
        </div>
      ) : null}

      {welcomeDismissed ? null : <WelcomeCard />}

      <NextActionCard
        state={guidanceState}
        pendingCount={pendingCount}
        openAlertCount={openAlertCount}
        role={user?.role}
      />

      {run ? (
        <div
          data-testid="latest-run-banner"
          className="rounded border border-gray-200 bg-gray-50 p-3 text-sm text-gray-700"
        >
          Latest run finished {formatTimestamp(run.finishedAt)} ·{" "}
          {extractRecommendationCount(run.counts)} recommendation
          {extractRecommendationCount(run.counts) === 1 ? "" : "s"}
        </div>
      ) : null}

      <section className="space-y-3">
        <div>
          <h1 className="text-lg font-semibold">Dashboard</h1>
          <p className="text-sm text-gray-500">
            Your buying position at a glance — and what to do next.
          </p>
        </div>

        {!run || tiles.length === 0 ? (
          <p className="text-sm text-gray-500" data-testid="dashboard-empty">
            No recommendations yet. Trigger a run from{" "}
            <Link href="/data" className="underline">
              /data
            </Link>
            .
          </p>
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {tiles.map((tile) => (
              <Tile key={tile.recommendationId} tile={tile} />
            ))}
          </div>
        )}
      </section>
    </main>
  );
}

function WelcomeCard() {
  return (
    <section
      data-testid="welcome-card"
      className="space-y-3 rounded border border-gray-200 bg-gray-50 p-4"
    >
      <h2 className="font-medium text-gray-900">Welcome to PDI</h2>
      <p className="text-sm text-gray-600">
        PDI reads your purchasing, consumption, stock and market-price files and tells you — for
        each material — whether to buy now, wait, or split the order, with the reasoning spelled
        out. You stay in charge: nothing is bought automatically, and every recommendation waits
        for your approve, override or reject. The weekly rhythm is simple — upload fresh data,
        run the analysis, decide, and watch the value add up in the pilot report.
      </p>
      <form action={dismissWelcomeAction}>
        <button
          type="submit"
          data-testid="welcome-dismiss"
          className="rounded border border-gray-300 px-3 py-1 text-sm text-gray-700"
        >
          Got it
        </button>
      </form>
    </section>
  );
}

interface GuidanceCopy {
  headline: (count: number) => string;
  explainer: string;
  ctaLabel: string;
  ctaHref: string;
}

// PRD-adjacent guidance copy (plan §2 table) — the single primary CTA per
// state, in priority order. "(s)" is rendered literally per the approved copy
// rather than pluralized, since the count already conveys the number.
const GUIDANCE_COPY: Record<GuidanceState, GuidanceCopy> = {
  NO_DATA: {
    headline: () => "Start by loading your data",
    explainer:
      "PDI works from your SAP exports — purchase orders, consumption, market prices and stock. Upload this week's files and PDI does the rest.",
    ctaLabel: "Upload data",
    ctaHref: "/data",
  },
  NO_RUN: {
    headline: () => "Your data is in — run the analysis",
    explainer:
      "A run turns the committed data into demand forecasts, price outlooks and a clear buy-or-wait call for each material. It takes about a minute.",
    ctaLabel: "Trigger a run",
    ctaHref: "/data#run",
  },
  REVIEW: {
    headline: (count) => `${count} recommendation(s) waiting for your decision`,
    explainer:
      "Each one tells you what to buy, when, how much and from whom — with the reasoning. Approve it, change it, or reject it. Nothing is bought without you.",
    ctaLabel: "Review recommendations",
    ctaHref: "/recommendations?status=PENDING",
  },
  ALERTS: {
    headline: (count) => `All decided — ${count} alert(s) need a look`,
    explainer:
      "Alerts flag stock cover running low, supplier concentration and sharp price moves before they become emergency buys.",
    ctaLabel: "Open alerts",
    ctaHref: "/alerts",
  },
  TRACK: {
    headline: () => "You're up to date",
    explainer:
      "Every decision is measured against the market baseline. See what the pilot has saved so far — then upload next week's data to start the next cycle.",
    ctaLabel: "View pilot report",
    ctaHref: "/reports/pilot",
  },
};

const STEP_LABELS: Record<WorkflowStep, string> = {
  UPLOAD: "Upload",
  RUN: "Run",
  REVIEW: "Review",
  DECIDE: "Decide",
  TRACK: "Track",
};

type ChipStatus = "done" | "current" | "upcoming";

function stepChipClass(status: ChipStatus): string {
  if (status === "current") {
    return "rounded-full bg-gray-900 px-3 py-1 text-xs font-medium text-white";
  }
  if (status === "done") {
    return "rounded-full bg-gray-100 px-3 py-1 text-xs font-medium text-gray-700";
  }
  return "rounded-full border border-gray-300 px-3 py-1 text-xs font-medium text-gray-400";
}

function NextActionCard({
  state,
  pendingCount,
  openAlertCount,
  role,
}: {
  state: GuidanceState;
  pendingCount: number;
  openAlertCount: number;
  role: Role | undefined;
}) {
  const copy = GUIDANCE_COPY[state];
  const count = state === "REVIEW" ? pendingCount : state === "ALERTS" ? openAlertCount : 0;
  const currentStep = mapStateToStep(state);
  const currentIndex = WORKFLOW_STEPS.indexOf(currentStep);
  const isViewer = role === "viewer";

  return (
    <section data-testid="next-action" className="space-y-4 rounded border border-gray-200 p-4">
      <div data-testid="workflow-steps" className="flex flex-wrap items-center gap-2">
        {WORKFLOW_STEPS.map((step, i) => {
          const status: ChipStatus = i < currentIndex ? "done" : i === currentIndex ? "current" : "upcoming";
          return (
            <span key={step} className="flex items-center gap-2">
              <span className={stepChipClass(status)}>{STEP_LABELS[step]}</span>
              {i < WORKFLOW_STEPS.length - 1 ? (
                <span aria-hidden="true" className="text-gray-300">
                  →
                </span>
              ) : null}
            </span>
          );
        })}
      </div>

      <div className="space-y-1">
        <h2 className="font-medium text-gray-900">{copy.headline(count)}</h2>
        <p className="text-sm text-gray-600">{copy.explainer}</p>
      </div>

      {isViewer ? (
        <p className="text-sm text-gray-500">A buyer or approver takes this step.</p>
      ) : (
        <Link
          href={copy.ctaHref}
          data-testid="next-action-cta"
          className="inline-block rounded bg-gray-900 px-4 py-2 text-sm font-medium text-white"
        >
          {copy.ctaLabel}
        </Link>
      )}
    </section>
  );
}

function Tile({ tile }: { tile: DashboardTile }) {
  const testId = `tile-${tile.materialCode}-${tile.plantCode}`;
  const inputs = tile.rationale.inputs;
  const pendingCount = tile.status === "PENDING" ? 1 : 0;

  if (!inputs) {
    // F5-ERR1/ERR3 degraded row (status=ERROR) — no cover/band data to show;
    // the tile still links through so the buyer can see the failure detail.
    return (
      <Link
        href={`/recommendations/${tile.recommendationId}`}
        data-testid={testId}
        className="block space-y-1 rounded border border-gray-200 p-4 text-sm"
      >
        <p className="font-medium text-gray-900">
          {tile.materialCode} · {tile.plantCode}
        </p>
        <p className="text-gray-500">Recommendation unavailable this run.</p>
      </Link>
    );
  }

  const breach = isCoverBreach(inputs.coverDays, inputs.minCoverDays);
  const direction = classifyBandDirection(inputs.band4w.p50, inputs.spotInrMt);
  const best = bestSupplierOffer(inputs.spread);

  return (
    <Link
      href={`/recommendations/${tile.recommendationId}`}
      data-testid={testId}
      className={`block space-y-2 rounded border p-4 text-sm ${
        breach ? "border-red-300 bg-red-50" : "border-gray-200"
      }`}
    >
      <p className="font-medium text-gray-900">
        {tile.materialCode} · {tile.plantCode}
      </p>

      <p className={breach ? "font-semibold text-red-700" : "text-gray-700"}>
        Cover {inputs.coverDays.toFixed(1)}d {breach ? "· below" : "vs"} {inputs.minCoverDays}d
        floor
      </p>

      <p className="text-gray-600">
        4w band {DIRECTION_ARROW[direction]} {direction} (P50 ₹
        {formatPriceInrMt(inputs.band4w.p50)} vs spot ₹{formatPriceInrMt(inputs.spotInrMt)})
      </p>

      {best ? (
        <p className="text-gray-600">
          Best offer: {best.supplierCode} @ ₹{formatPriceInrMt(best.priceInrMt)}/MT
        </p>
      ) : null}

      <p className="text-xs text-gray-500">
        {pendingCount} pending recommendation{pendingCount === 1 ? "" : "s"}
      </p>
    </Link>
  );
}
