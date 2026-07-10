import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { getDb, getSql } from "@/db/client";
import { runs } from "@/db/schema/analytics";

import { runOrchestrator } from "./run-orchestrator";

// F2-AC3/F2-ERR4 at the orchestrator level: runOrchestrator invoked directly (this is
// exactly what the runs POST route's `after()` would eventually call) against a live Run
// row, with global fetch mocked to stand in for the engine. Complements runs.test.ts,
// which mocks this module out to test the route/409/404 surface in isolation.

const ORIGINAL_FETCH = global.fetch;
const ORIGINAL_ENGINE_URL = process.env.ENGINE_URL;

async function insertRun(): Promise<string> {
  const [run] = await getDb().insert(runs).values({}).returning({ id: runs.id });
  return run.id;
}

async function loadRun(id: string) {
  const [run] = await getDb().select().from(runs).where(eq(runs.id, id)).limit(1);
  return run;
}

async function deleteRun(id: string): Promise<void> {
  await getSql()`delete from runs where id = ${id}`;
}

beforeEach(() => {
  process.env.ENGINE_URL = "http://engine.test";
});

afterEach(() => {
  vi.clearAllMocks();
  global.fetch = ORIGINAL_FETCH;
  process.env.ENGINE_URL = ORIGINAL_ENGINE_URL;
});

afterAll(async () => {
  await getSql().end();
});

describe("runOrchestrator", () => {
  it("F2-AC3: all four stages succeed -> Run DONE with counts from each stage", async () => {
    const runId = await insertRun();

    global.fetch = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.endsWith("/v1/forecast/demand")) {
        return new Response(JSON.stringify({ series: 5, forecasts: 5 }), { status: 200 });
      }
      if (url.endsWith("/v1/forecast/price")) {
        return new Response(JSON.stringify({ series: 3, bands: 3 }), { status: 200 });
      }
      if (url.endsWith("/v1/recommend")) {
        return new Response(JSON.stringify({ recommendations: 2 }), { status: 200 });
      }
      if (url.endsWith("/v1/alerts")) {
        return new Response(JSON.stringify({ alerts: 1 }), { status: 200 });
      }
      throw new Error(`unexpected stage URL: ${url}`);
    }) as unknown as typeof fetch;

    await runOrchestrator(runId);
    const run = await loadRun(runId);

    expect(run.status).toBe("DONE");
    expect(run.finishedAt).not.toBeNull();
    expect(run.counts).toEqual({
      demand: { series: 5, forecasts: 5 },
      price: { series: 3, bands: 3 },
      recommend: { recommendations: 2 },
      alerts: { alerts: 1 },
    });
    expect(run.warnings).toEqual([]);

    await deleteRun(runId);
  });

  it("F2-ERR4: engine down (fetch rejects) -> Run FAILED with ENGINE_UNAVAILABLE + failing stage", async () => {
    const runId = await insertRun();

    global.fetch = vi.fn(async () => {
      throw new TypeError("fetch failed: ECONNREFUSED");
    }) as unknown as typeof fetch;

    await runOrchestrator(runId);
    const run = await loadRun(runId);

    expect(run.status).toBe("FAILED");
    expect(run.finishedAt).not.toBeNull();
    expect(run.warnings).toEqual([
      { code: "ENGINE_UNAVAILABLE", stage: "demand", detail: "fetch failed: ECONNREFUSED" },
    ]);

    await deleteRun(runId);
  });

  it("F2-ERR4: non-200 stage response -> Run FAILED, same ENGINE_UNAVAILABLE contract", async () => {
    const runId = await insertRun();

    global.fetch = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.endsWith("/v1/forecast/demand")) {
        return new Response(JSON.stringify({ series: 5, forecasts: 5 }), { status: 200 });
      }
      if (url.endsWith("/v1/forecast/price")) {
        return new Response("internal error", { status: 500 });
      }
      throw new Error(`unexpected stage URL: ${url}`);
    }) as unknown as typeof fetch;

    await runOrchestrator(runId);
    const run = await loadRun(runId);

    expect(run.status).toBe("FAILED");
    expect(run.warnings).toEqual([
      { code: "ENGINE_UNAVAILABLE", stage: "price", detail: "stage responded with HTTP 500" },
    ]);
    // Stage prior to the failing one is still recorded — no data is silently dropped.
    expect(run.counts).toEqual({ demand: { series: 5, forecasts: 5 } });

    await deleteRun(runId);
  });

  it("ENGINE_URL not configured -> Run FAILED with ENGINE_UNAVAILABLE, no fetch attempted", async () => {
    const runId = await insertRun();
    delete process.env.ENGINE_URL;

    const fetchSpy = vi.fn();
    global.fetch = fetchSpy as unknown as typeof fetch;

    await runOrchestrator(runId);
    const run = await loadRun(runId);

    expect(run.status).toBe("FAILED");
    expect(run.warnings).toEqual([
      { code: "ENGINE_UNAVAILABLE", stage: "config", detail: "ENGINE_URL not configured" },
    ]);
    expect(fetchSpy).not.toHaveBeenCalled();

    await deleteRun(runId);
  });
});
