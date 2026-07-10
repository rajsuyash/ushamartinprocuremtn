import { eq } from "drizzle-orm";

import { getDb } from "@/db/client";
import { runs } from "@/db/schema/analytics";
import { getEngineUrl } from "@/env";

// D3 (EXECUTION_PLAN §C): web-side sequential orchestrator over stateless engine stages.
// The engine is internal-only (PRD §4) and never touches Run status itself — this module
// is the single writer of `runs.status/warnings/counts/finished_at`.
const STAGE_TIMEOUT_MS = 60_000;

const STAGES = [
  { key: "demand", path: "/v1/forecast/demand" },
  { key: "price", path: "/v1/forecast/price" },
  { key: "recommend", path: "/v1/recommend" },
] as const;

type StageOutcome =
  | { ok: true; counts: unknown }
  | { ok: false; detail: string };

async function callStage(baseUrl: string, path: string, runId: string): Promise<StageOutcome> {
  try {
    const res = await fetch(`${baseUrl}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ run_id: runId }),
      signal: AbortSignal.timeout(STAGE_TIMEOUT_MS),
    });

    if (!res.ok) {
      return { ok: false, detail: `stage responded with HTTP ${res.status}` };
    }

    return { ok: true, counts: await res.json() };
  } catch (err) {
    // Covers network failure (ECONNREFUSED, DNS), and AbortError from the timeout.
    return { ok: false, detail: err instanceof Error ? err.message : String(err) };
  }
}

async function failRun(
  runId: string,
  stage: string,
  detail: string,
  countsSoFar: Record<string, unknown>,
): Promise<void> {
  await getDb()
    .update(runs)
    .set({
      status: "FAILED",
      finishedAt: new Date(),
      warnings: [{ code: "ENGINE_UNAVAILABLE", stage, detail }],
      counts: countsSoFar,
    })
    .where(eq(runs.id, runId));
}

/**
 * Runs every engine stage sequentially for a QUEUED run (F2-AC3 happy path, F2-ERR4 engine-
 * down path). Never throws — the caller (the runs POST route, via next/server's `after()`)
 * cannot await this, so every failure is logged and persisted on the Run row instead of
 * propagating. Retry-safety: stages are stateless (M1 stubs write nothing), so a FAILED run
 * leaves no partial state to clean up — a retry is just a fresh `POST /api/runs`.
 */
export async function runOrchestrator(runId: string): Promise<void> {
  const db = getDb();
  const counts: Record<string, unknown> = {};

  try {
    await db.update(runs).set({ status: "RUNNING", startedAt: new Date() }).where(eq(runs.id, runId));

    const baseUrl = getEngineUrl();
    if (!baseUrl) {
      await failRun(runId, "config", "ENGINE_URL not configured", counts);
      return;
    }

    for (const stage of STAGES) {
      const outcome = await callStage(baseUrl, stage.path, runId);

      if (!outcome.ok) {
        await failRun(runId, stage.key, outcome.detail, counts);
        return;
      }

      counts[stage.key] = outcome.counts;
    }

    await db.update(runs).set({ status: "DONE", finishedAt: new Date(), counts }).where(eq(runs.id, runId));
  } catch (err) {
    console.error(
      JSON.stringify({
        level: "error",
        runId,
        message: err instanceof Error ? err.message : String(err),
      }),
    );
    try {
      await failRun(runId, "orchestrator", "unexpected orchestrator error", counts);
    } catch {
      // DB itself unreachable — already logged above; nothing more to do without throwing.
    }
  }
}
