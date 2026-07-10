import { fail, ok } from "@pdi/shared";
import { inArray } from "drizzle-orm";
import { after } from "next/server";

import { CAPABILITIES } from "@/auth/access";
import { getDb } from "@/db/client";
import { runs } from "@/db/schema/analytics";
import { withApiAuth } from "@/lib/api-guard";
import { runOrchestrator } from "@/lib/run-orchestrator";

// F2-AC3/F2-ERR4: 202-then-poll contract. The Run row is created and returned
// immediately; the orchestrator (sequential engine-stage calls) runs post-response via
// next/server's `after()` so the client never waits on the recompute — the UI polls
// GET /api/runs/:id instead. Retry-safety: M1 engine stages persist nothing, so a
// FAILED run carries no partial state to clean up — retrying is just a fresh POST
// (a new Run row), never a resume of the failed one.
//
// Assumption: the PRD doesn't spell out concurrent-run behavior, only implies "one
// recompute" via the Run model. We treat a QUEUED/RUNNING run as exclusive — a second
// POST while one is in flight is rejected with 409 RUN_IN_PROGRESS rather than queued
// behind it or run concurrently.
function scheduleOrchestrator(runId: string): void {
  try {
    after(() => runOrchestrator(runId));
  } catch {
    // `after()` requires Next's per-request scope; it throws when the route handler is
    // invoked directly outside that scope (our own integration tests — see
    // runs.test.ts). Fall back to firing the orchestrator without blocking the
    // response, same 202-then-poll contract either way.
    void runOrchestrator(runId);
  }
}

export const POST = withApiAuth(
  async () => {
    const db = getDb();

    const inFlight = await db
      .select({ id: runs.id })
      .from(runs)
      .where(inArray(runs.status, ["QUEUED", "RUNNING"]))
      .limit(1);

    if (inFlight.length > 0) {
      return Response.json(fail("RUN_IN_PROGRESS", "A run is already in progress."), {
        status: 409,
      });
    }

    const [run] = await db.insert(runs).values({}).returning({ id: runs.id });

    scheduleOrchestrator(run.id);

    return Response.json(ok({ runId: run.id }), { status: 202 });
  },
  { roles: CAPABILITIES.MUTATE_DATA },
);
