import { eq } from "drizzle-orm";
import Link from "next/link";

import { getDashboardTiles, getLatestDoneRun } from "@/app/queries";
import { auth } from "@/auth";
import { canEditPolicy } from "@/auth/access";
import { getDb } from "@/db/client";
import { policyConfigs } from "@/db/schema";

import { SimulatorPanel, type PolicyDefaults, type SeriesOption } from "./simulator-panel";

// F10 Strategy Planner (`/sandbox`): read-only what-if sandbox over the latest
// DONE run. Nothing here persists — the engine's /v1/simulate writes no rows
// and no decision can be taken on a simulated result.
export default async function SandboxPage() {
  const session = await auth();
  const role = session?.user?.role;

  const run = await getLatestDoneRun();

  if (!run) {
    return (
      <main className="mx-auto max-w-5xl space-y-6 p-8">
        <PageHeader />
        <p className="text-sm text-muted" data-testid="sandbox-empty">
          No completed run yet. Trigger a run from{" "}
          <Link href="/data" className="underline">
            /data
          </Link>{" "}
          first — the sandbox simulates against the latest run&apos;s forecasts.
        </p>
      </main>
    );
  }

  const tiles = await getDashboardTiles(run.id);
  const series: SeriesOption[] = tiles.map((t) => ({
    materialCode: t.materialCode,
    plantCode: t.plantCode,
    recommendationId: t.recommendationId,
  }));

  const db = getDb();
  const [policy] = await db
    .select({
      minCoverDays: policyConfigs.minCoverDays,
      targetCoverDays: policyConfigs.targetCoverDays,
      maxSupplierSharePct: policyConfigs.maxSupplierSharePct,
      wcCapInr: policyConfigs.wcCapInr,
    })
    .from(policyConfigs)
    .where(eq(policyConfigs.isActive, true))
    .limit(1);

  const policyDefaults: PolicyDefaults = {
    minCoverDays: policy?.minCoverDays ?? 21,
    maxSupplierSharePct: policy ? Number(policy.maxSupplierSharePct) : 60,
    wcCapInr: policy?.wcCapInr ?? null,
  };

  return (
    <main className="mx-auto max-w-6xl space-y-6 p-8">
      <PageHeader />
      <SimulatorPanel
        series={series}
        policyDefaults={policyDefaults}
        isViewer={role === "viewer"}
        showPolicyLink={canEditPolicy(role)}
      />
    </main>
  );
}

function PageHeader() {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div>
        <h1 className="text-2xl font-semibold text-ink">Strategy Planner</h1>
        <p className="text-sm text-muted">
          Simulate what-if scenarios against the latest run — tweak policy, lead times, prices or a
          forced buy, and compare against the system&apos;s plan. Nothing here is saved or decided.
        </p>
      </div>
      <Link
        href="/guide#inputs"
        className="flex flex-shrink-0 items-center gap-1.5 rounded border border-border px-3 py-1.5 text-sm font-medium text-ink hover:bg-surface-alt"
      >
        <span className="material-symbols-outlined text-[18px]" aria-hidden="true">
          help
        </span>
        How to use this
      </Link>
    </div>
  );
}
