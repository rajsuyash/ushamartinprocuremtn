import Link from "next/link";

import { auth, signOut } from "@/auth";
import { getOpenAlertCount } from "@/app/alerts/queries";

import { formatPriceInrMt } from "./forecasts/format";
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

      <header className="flex items-center justify-between">
        <div>
          <p className="text-sm text-gray-500">Signed in as</p>
          <p className="font-medium">{user?.name ?? user?.email}</p>
        </div>
        <div className="flex items-center gap-3">
          <Link
            href="/alerts"
            data-testid="alert-bell"
            className="rounded-full bg-gray-100 px-3 py-1 text-xs font-medium text-gray-700"
            title="Open alerts"
          >
            {openAlertCount} alerts
          </Link>
          <span
            data-testid="role-chip"
            className="rounded-full bg-gray-100 px-3 py-1 text-xs font-medium text-gray-700"
          >
            {user?.role}
          </span>
          <form
            action={async () => {
              "use server";
              await signOut({ redirectTo: "/login" });
            }}
          >
            <button
              type="submit"
              data-action="sign-out"
              className="rounded border border-gray-300 px-3 py-1 text-sm"
            >
              Sign out
            </button>
          </form>
        </div>
      </header>

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
        <h1 className="text-lg font-semibold">Dashboard</h1>

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
