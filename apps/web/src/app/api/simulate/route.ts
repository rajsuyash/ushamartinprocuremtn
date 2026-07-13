import { fail, ok, simulateInputSchema, type SimulateResult } from "@pdi/shared";
import { desc, eq } from "drizzle-orm";

import { CAPABILITIES } from "@/auth/access";
import { getDb } from "@/db/client";
import { runs } from "@/db/schema/analytics";
import { getEngineUrl } from "@/env";
import { withApiAuth } from "@/lib/api-guard";

// F10 scenario simulation: synchronous proxy to the engine's read-only
// /v1/simulate. Nothing is persisted — no Run row, no analytical rows. The
// baseline is the latest DONE run's forecasts for the requested series.

const SIMULATE_TIMEOUT_MS = 15_000;

export const POST = withApiAuth(
  async (req) => {
    const parsed = simulateInputSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      return Response.json(
        fail("VALIDATION_ERROR", "Invalid simulation input.", {
          issues: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`),
        }),
        { status: 400 },
      );
    }

    const db = getDb();
    const [latestDone] = await db
      .select({ id: runs.id })
      .from(runs)
      .where(eq(runs.status, "DONE"))
      .orderBy(desc(runs.finishedAt))
      .limit(1);

    if (!latestDone) {
      return Response.json(
        fail("NO_COMPLETED_RUN", "No completed run to simulate against — trigger a run first."),
        { status: 409 },
      );
    }

    const engineUrl = getEngineUrl();
    if (!engineUrl) {
      return Response.json(fail("ENGINE_UNAVAILABLE", "Engine is not configured."), {
        status: 502,
      });
    }

    const { materialCode, plantCode, overrides } = parsed.data;
    let engineRes: Response;
    try {
      engineRes = await fetch(`${engineUrl}/v1/simulate`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          run_id: latestDone.id,
          material_code: materialCode,
          plant_code: plantCode,
          overrides: {
            forced_qty_mt: overrides.forcedQtyMt,
            lead_time_buffer_days: overrides.leadTimeBufferDays,
            price_shift_pct: overrides.priceShiftPct,
            min_cover_days: overrides.minCoverDays,
            max_supplier_share_pct: overrides.maxSupplierSharePct,
            wc_cap_inr: overrides.wcCapInr,
          },
        }),
        signal: AbortSignal.timeout(SIMULATE_TIMEOUT_MS),
      });
    } catch {
      return Response.json(fail("ENGINE_UNAVAILABLE", "Engine did not respond."), {
        status: 502,
      });
    }

    if (!engineRes.ok) {
      const detail = await engineRes
        .json()
        .then((b: { detail?: { code?: string } }) => b?.detail?.code)
        .catch(() => undefined);
      return Response.json(
        fail(
          "SIMULATION_FAILED",
          "The engine could not simulate this series.",
          detail ? { engineCode: detail } : undefined,
        ),
        { status: 422 },
      );
    }

    const result = (await engineRes.json()) as SimulateResult;
    return Response.json(ok(result), { status: 200 });
  },
  { roles: CAPABILITIES.MUTATE_DATA },
);
