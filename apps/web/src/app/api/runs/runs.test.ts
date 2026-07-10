import type { Session } from "next-auth";
import { NextRequest } from "next/server";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";

import type { Role } from "@/auth/access";
import { getSql } from "@/db/client";

// Integration tests for F2-AC3 (happy-path run reaches DONE) / F2-ERR4 (engine-down ->
// FAILED) at the route level: route handlers invoked directly (no Next server), auth()
// mocked, T7 test pattern. The orchestrator itself is mocked here — its stage-by-stage
// behavior (DONE with counts, FAILED on engine-down/non-200) is covered directly in
// run-orchestrator.test.ts, since `after()` cannot run post-response outside a real Next
// request scope (see route.ts's scheduleOrchestrator fallback).
vi.mock("@/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/run-orchestrator", () => ({ runOrchestrator: vi.fn() }));

const { auth } = await import("@/auth");
const { runOrchestrator } = await import("@/lib/run-orchestrator");
const { GET: runGET } = await import("./[id]/route");
const { POST: runsPOST } = await import("./route");

const mockAuth = vi.mocked(auth as unknown as () => Promise<Session | null>);
const mockOrchestrator = vi.mocked(runOrchestrator);

function sessionFor(role: Role): Session {
  return {
    user: { id: "44444444-4444-4444-4444-444444444444", email: `${role}@pdi.test`, role },
    expires: new Date(Date.now() + 3_600_000).toISOString(),
  } as Session;
}

const postReq = () => new NextRequest("http://localhost:3000/api/runs", { method: "POST" });
const getReq = (id: string) => new NextRequest(`http://localhost:3000/api/runs/${id}`);
const getCtx = (id: string) => ({ params: Promise.resolve({ id }) });

async function deleteRuns(ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  await getSql()`delete from runs where id = any(${ids})`;
}

afterEach(() => vi.clearAllMocks());
afterAll(async () => {
  await getSql().end();
});

describe("POST /api/runs", () => {
  it("no session -> 401 UNAUTHENTICATED", async () => {
    mockAuth.mockResolvedValue(null);
    const res = await runsPOST(postReq());

    expect(res.status).toBe(401);
    expect((await res.json()).error.code).toBe("UNAUTHENTICATED");
  });

  it("viewer -> 403 FORBIDDEN_ROLE (MUTATE_DATA excludes viewer)", async () => {
    mockAuth.mockResolvedValue(sessionFor("viewer"));
    const res = await runsPOST(postReq());

    expect(res.status).toBe(403);
    expect((await res.json()).error.code).toBe("FORBIDDEN_ROLE");
  });

  it("F2-AC3: buyer creates a run -> 202 + runId, Run row QUEUED, orchestrator scheduled", async () => {
    mockAuth.mockResolvedValue(sessionFor("buyer"));
    const res = await runsPOST(postReq());
    const body = await res.json();

    expect(res.status).toBe(202);
    expect(body.success).toBe(true);
    expect(typeof body.data.runId).toBe("string");
    expect(mockOrchestrator).toHaveBeenCalledWith(body.data.runId);

    await deleteRuns([body.data.runId]);
  });

  it("409 RUN_IN_PROGRESS when a run is already QUEUED/RUNNING", async () => {
    mockAuth.mockResolvedValue(sessionFor("buyer"));

    const first = await runsPOST(postReq());
    const firstBody = await first.json();
    expect(first.status).toBe(202);

    const second = await runsPOST(postReq());
    const secondBody = await second.json();

    expect(second.status).toBe(409);
    expect(secondBody.error.code).toBe("RUN_IN_PROGRESS");

    await deleteRuns([firstBody.data.runId]);
  });
});

describe("GET /api/runs/:id", () => {
  it("unknown id -> 404 NOT_FOUND", async () => {
    mockAuth.mockResolvedValue(sessionFor("viewer"));
    const res = await runGET(
      getReq("99999999-9999-9999-9999-999999999999"),
      getCtx("99999999-9999-9999-9999-999999999999"),
    );

    expect(res.status).toBe(404);
    expect((await res.json()).error.code).toBe("NOT_FOUND");
  });

  it("no session -> 401 UNAUTHENTICATED", async () => {
    mockAuth.mockResolvedValue(null);
    const res = await runGET(getReq("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"), getCtx("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"));

    expect(res.status).toBe(401);
  });

  it("returns status/counts/warnings/timestamps for any authenticated role", async () => {
    mockAuth.mockResolvedValue(sessionFor("buyer"));
    const created = await runsPOST(postReq());
    const { data } = await created.json();

    mockAuth.mockResolvedValue(sessionFor("viewer"));
    const res = await runGET(getReq(data.runId), getCtx(data.runId));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data.run.id).toBe(data.runId);
    expect(body.data.run.status).toBe("QUEUED");
    expect(body.data.run.counts).toEqual({});
    expect(body.data.run.warnings).toEqual([]);
    expect(body.data.run.createdAt).toBeTruthy();

    await deleteRuns([data.runId]);
  });
});
