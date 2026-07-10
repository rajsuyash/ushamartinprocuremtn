import type { Session } from "next-auth";
import { NextRequest } from "next/server";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";

import type { Role } from "@/auth/access";
import { getSql } from "@/db/client";

import { POST as decisionPOST } from "./[id]/decision/route";
import { GET as recommendationsGET } from "./route";

// Integration tests for F1-AC3 / F1-ERR2: route handlers invoked directly (no Next
// server) with auth() mocked, DecisionRecord side effects asserted against the live
// compose postgres (DATABASE_URL required, localhost:5442).

vi.mock("@/auth", () => ({ auth: vi.fn() }));

const { auth } = await import("@/auth");
const mockAuth = vi.mocked(auth as unknown as () => Promise<Session | null>);

function sessionFor(role: Role): Session {
  return {
    user: { id: "22222222-2222-2222-2222-222222222222", email: `${role}@pdi.test`, role },
    expires: new Date(Date.now() + 3_600_000).toISOString(),
  } as Session;
}

const getReq = () => new NextRequest("http://localhost:3000/api/recommendations");
const postReq = (id: string) =>
  new NextRequest(`http://localhost:3000/api/recommendations/${id}/decision`, {
    method: "POST",
  });
const postCtx = (id: string) => ({ params: Promise.resolve({ id }) });

async function decisionCount(): Promise<number> {
  const [row] = await getSql()`select count(*)::int as n from decision_records`;
  return row.n as number;
}

async function insertRun(): Promise<string> {
  // Vitest runs test files in parallel workers against the same live Postgres;
  // a bare QUEUED/RUNNING run row here would trip the global "one run at a
  // time" 409 invariant in runs.test.ts's concurrently-running suite. This
  // fixture only needs a run_id FK target, so mark it DONE up front.
  const [row] = await getSql()`insert into runs (status) values ('DONE') returning id`;
  return row.id as string;
}

async function insertRecommendation(params: {
  runId: string;
  materialCode: string;
  plantCode: string;
  play: string | null;
  status?: string;
  rationale?: unknown;
}): Promise<string> {
  const sql = getSql();
  const [material] = await sql`select id from materials where code = ${params.materialCode}`;
  const [plant] = await sql`select id from plants where code = ${params.plantCode}`;
  const [row] = await sql`
    insert into recommendations (run_id, material_id, plant_id, play, status, rationale)
    values (
      ${params.runId}, ${material.id}, ${plant.id}, ${params.play}, ${params.status ?? "PENDING"},
      ${JSON.stringify(params.rationale ?? {})}::jsonb
    )
    returning id
  `;
  return row.id as string;
}

async function cleanupRunAndRecs(runId: string): Promise<void> {
  const sql = getSql();
  await sql`delete from recommendations where run_id = ${runId}`;
  await sql`delete from runs where id = ${runId}`;
}

afterEach(() => vi.clearAllMocks());
afterAll(async () => {
  await getSql().end();
});

describe("GET /api/recommendations", () => {
  it("F1-AC3: no session → 401 exact UNAUTHENTICATED envelope", async () => {
    mockAuth.mockResolvedValue(null);
    const res = await recommendationsGET(getReq());

    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({
      success: false,
      data: null,
      error: { code: "UNAUTHENTICATED", message: "Authentication required." },
    });
  });

  it("viewer can GET recommendations (VIEW = all four roles)", async () => {
    mockAuth.mockResolvedValue(sessionFor("viewer"));
    const res = await recommendationsGET(getReq());

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      success: true,
      data: { recommendations: [] },
      error: null,
    });
  });

  it("filters by status/material/plant (T22 — seeded FIX-2 codes)", async () => {
    mockAuth.mockResolvedValue(sessionFor("buyer"));
    const runId = await insertRun();
    try {
      const buyNowId = await insertRecommendation({
        runId,
        materialCode: "WR-5.5-HC",
        plantCode: "RNC",
        play: "BUY_NOW",
      });
      const waitId = await insertRecommendation({
        runId,
        materialCode: "WR-8-MS",
        plantCode: "HSP",
        play: "WAIT",
        status: "EXPIRED",
      });

      const byStatus = await recommendationsGET(
        new NextRequest("http://localhost:3000/api/recommendations?status=PENDING"),
      );
      const byStatusIds = (await byStatus.json()).data.recommendations.map(
        (r: { id: string }) => r.id,
      );
      expect(byStatusIds).toContain(buyNowId);
      expect(byStatusIds).not.toContain(waitId);

      const byMaterialPlant = await recommendationsGET(
        new NextRequest(
          "http://localhost:3000/api/recommendations?material=WR-8-MS&plant=HSP",
        ),
      );
      const byMaterialPlantBody = await byMaterialPlant.json();
      expect(byMaterialPlantBody.data.recommendations).toHaveLength(1);
      expect(byMaterialPlantBody.data.recommendations[0]).toMatchObject({
        id: waitId,
        materialCode: "WR-8-MS",
        plantCode: "HSP",
        play: "WAIT",
        status: "EXPIRED",
      });
    } finally {
      await cleanupRunAndRecs(runId);
    }
  });

  it("F5-ERR1: an ERROR-status row (no play) serializes cleanly and status=ERROR filters to it", async () => {
    mockAuth.mockResolvedValue(sessionFor("buyer"));
    const runId = await insertRun();
    try {
      const errorId = await insertRecommendation({
        runId,
        materialCode: "WR-5.5-HC",
        plantCode: "RNC",
        play: null,
        status: "ERROR",
        rationale: {
          error: { code: "NO_FEASIBLE_PLAN", bindingConstraints: ["MIN_COVER_21D"] },
        },
      });

      const res = await recommendationsGET(
        new NextRequest("http://localhost:3000/api/recommendations?status=ERROR"),
      );
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.success).toBe(true);
      expect(body.data.recommendations).toHaveLength(1);
      expect(body.data.recommendations[0]).toMatchObject({
        id: errorId,
        play: null,
        status: "ERROR",
        orderLines: [],
        rationale: {
          error: { code: "NO_FEASIBLE_PLAN", bindingConstraints: ["MIN_COVER_21D"] },
        },
      });
    } finally {
      await cleanupRunAndRecs(runId);
    }
  });

  it("defaults to a bounded limit (pagination pitfall)", async () => {
    mockAuth.mockResolvedValue(sessionFor("buyer"));
    const res = await recommendationsGET(
      new NextRequest("http://localhost:3000/api/recommendations?limit=not-a-number"),
    );
    expect(res.status).toBe(200);
    expect((await res.json()).success).toBe(true);
  });
});

describe("POST /api/recommendations/:id/decision", () => {
  const recId = "33333333-3333-3333-3333-333333333333";

  it("F1-ERR2: viewer → 403 FORBIDDEN_ROLE and NO DecisionRecord created", async () => {
    const before = await decisionCount();

    mockAuth.mockResolvedValue(sessionFor("viewer"));
    const res = await decisionPOST(postReq(recId), postCtx(recId));

    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.success).toBe(false);
    expect(body.error.code).toBe("FORBIDDEN_ROLE");

    expect(await decisionCount()).toBe(before);
  });

  it("no session → 401 UNAUTHENTICATED (per-route, not middleware)", async () => {
    mockAuth.mockResolvedValue(null);
    const res = await decisionPOST(postReq(recId), postCtx(recId));
    expect(res.status).toBe(401);
    expect((await res.json()).error.code).toBe("UNAUTHENTICATED");
  });

  it("buyer passes the DECIDE guard — reaches the 501 stub", async () => {
    mockAuth.mockResolvedValue(sessionFor("buyer"));
    const res = await decisionPOST(postReq(recId), postCtx(recId));

    expect(res.status).toBe(501);
    expect((await res.json()).error.code).toBe("NOT_IMPLEMENTED");
  });

  it("approver and admin also pass; viewer is the only role denied", async () => {
    for (const role of ["approver", "admin"] as const) {
      mockAuth.mockResolvedValue(sessionFor(role));
      const res = await decisionPOST(postReq(recId), postCtx(recId));
      expect(res.status).toBe(501);
    }
  });
});
