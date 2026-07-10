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
  // decision_records FK-references recommendations — clear fixtures first. (App code
  // never deletes decisions; this is test teardown only.)
  await sql`
    delete from decision_records
    where recommendation_id in (select id from recommendations where run_id = ${runId})
  `;
  await sql`delete from recommendations where run_id = ${runId}`;
  await sql`delete from runs where id = ${runId}`;
}

async function seededUser(
  email: string,
): Promise<{ id: string; email: string }> {
  const [row] = await getSql()`select id, email from users where email = ${email}`;
  return { id: row.id as string, email: row.email as string };
}

// A session whose user.id is a REAL seeded user — decision_records.decided_by FK
// requires it (the hardcoded id in sessionFor() would violate the FK).
function realSession(user: { id: string; email: string }, role: Role): Session {
  return {
    user: { id: user.id, email: user.email, role },
    expires: new Date(Date.now() + 3_600_000).toISOString(),
  } as Session;
}

const decisionBody = (body: unknown) => (id: string) =>
  new NextRequest(`http://localhost:3000/api/recommendations/${id}/decision`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

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

describe("POST /api/recommendations/:id/decision (T25)", () => {
  const unknownId = "33333333-3333-3333-3333-333333333333";
  const approveBody = { action: "APPROVE", note: "", idempotencyKey: "idem-approve" };

  async function pendingRec(): Promise<{ runId: string; recId: string }> {
    const runId = await insertRun();
    const recId = await insertRecommendation({
      runId,
      materialCode: "WR-5.5-HC",
      plantCode: "RNC",
      play: "BUY_NOW",
      status: "PENDING",
    });
    return { runId, recId };
  }

  // --- guard boundary (unchanged from the T7 stub era) ---

  it("F1-ERR2: viewer → 403 FORBIDDEN_ROLE and NO DecisionRecord created", async () => {
    const before = await decisionCount();
    mockAuth.mockResolvedValue(sessionFor("viewer"));
    const res = await decisionPOST(postReq(unknownId), postCtx(unknownId));

    expect(res.status).toBe(403);
    expect((await res.json()).error.code).toBe("FORBIDDEN_ROLE");
    expect(await decisionCount()).toBe(before);
  });

  it("no session → 401 UNAUTHENTICATED (per-route, not middleware)", async () => {
    mockAuth.mockResolvedValue(null);
    const res = await decisionPOST(postReq(unknownId), postCtx(unknownId));
    expect(res.status).toBe(401);
    expect((await res.json()).error.code).toBe("UNAUTHENTICATED");
  });

  it("unknown recommendation → 404 NOT_FOUND, no row written", async () => {
    const before = await decisionCount();
    mockAuth.mockResolvedValue(realSession(await seededUser("buyer@pdi.test"), "buyer"));
    const res = await decisionPOST(decisionBody(approveBody)(unknownId), postCtx(unknownId));

    expect(res.status).toBe(404);
    expect((await res.json()).error.code).toBe("NOT_FOUND");
    expect(await decisionCount()).toBe(before);
  });

  // --- happy paths: 201 + status flip + immutable audit row ---

  it("APPROVE → 201, status flips to APPROVED, audit fields captured", async () => {
    const buyer = await seededUser("buyer@pdi.test");
    mockAuth.mockResolvedValue(realSession(buyer, "buyer"));
    const { runId, recId } = await pendingRec();
    try {
      const before = await decisionCount();
      const res = await decisionPOST(decisionBody(approveBody)(recId), postCtx(recId));
      const body = await res.json();

      expect(res.status).toBe(201);
      expect(body.success).toBe(true);
      expect(body.data.status).toBe("APPROVED");
      expect(body.data.decision).toMatchObject({
        recommendationId: recId,
        action: "APPROVE",
        note: "",
        override: null,
        decidedBy: buyer.id,
        decidedByEmail: buyer.email,
      });
      expect(typeof body.data.decision.decidedAt).toBe("string");

      expect(await decisionCount()).toBe(before + 1);
      const [rec] = await getSql()`select status from recommendations where id = ${recId}`;
      expect(rec.status).toBe("APPROVED");
    } finally {
      await cleanupRunAndRecs(runId);
    }
  });

  it("OVERRIDE with play + 20-char note → 201, status OVERRIDDEN, override stored", async () => {
    mockAuth.mockResolvedValue(realSession(await seededUser("approver@pdi.test"), "approver"));
    const { runId, recId } = await pendingRec();
    try {
      const res = await decisionPOST(
        decisionBody({
          action: "OVERRIDE",
          note: "cover is fine, waiting",
          override: { play: "WAIT" },
          idempotencyKey: "idem-override",
        })(recId),
        postCtx(recId),
      );
      const body = await res.json();

      expect(res.status).toBe(201);
      expect(body.data.status).toBe("OVERRIDDEN");
      expect(body.data.decision.override).toEqual({ play: "WAIT" });
      const [rec] = await getSql()`select status from recommendations where id = ${recId}`;
      expect(rec.status).toBe("OVERRIDDEN");
    } finally {
      await cleanupRunAndRecs(runId);
    }
  });

  it("REJECT with a valid note → 201, status REJECTED", async () => {
    mockAuth.mockResolvedValue(realSession(await seededUser("buyer@pdi.test"), "buyer"));
    const { runId, recId } = await pendingRec();
    try {
      const res = await decisionPOST(
        decisionBody({
          action: "REJECT",
          note: "not buying this week",
          idempotencyKey: "idem-reject",
        })(recId),
        postCtx(recId),
      );
      expect(res.status).toBe(201);
      expect((await res.json()).data.status).toBe("REJECTED");
    } finally {
      await cleanupRunAndRecs(runId);
    }
  });

  // --- input validation: named codes, no side effects ---

  it("OVERRIDE/REJECT with too-short note → 400 NOTE_REQUIRED, nothing recorded", async () => {
    mockAuth.mockResolvedValue(realSession(await seededUser("buyer@pdi.test"), "buyer"));
    const { runId, recId } = await pendingRec();
    try {
      const before = await decisionCount();

      const empty = await decisionPOST(
        decisionBody({
          action: "OVERRIDE",
          note: "",
          override: { play: "WAIT" },
          idempotencyKey: "idem-n1",
        })(recId),
        postCtx(recId),
      );
      expect(empty.status).toBe(400);
      expect((await empty.json()).error.code).toBe("NOTE_REQUIRED");

      const nineChars = await decisionPOST(
        decisionBody({ action: "REJECT", note: "too short", idempotencyKey: "idem-n2" })(recId),
        postCtx(recId),
      );
      expect(nineChars.status).toBe(400);
      expect((await nineChars.json()).error.code).toBe("NOTE_REQUIRED");

      expect(await decisionCount()).toBe(before);
    } finally {
      await cleanupRunAndRecs(runId);
    }
  });

  it("OVERRIDE without override.play → 400 OVERRIDE_PLAY_REQUIRED", async () => {
    mockAuth.mockResolvedValue(realSession(await seededUser("buyer@pdi.test"), "buyer"));
    const { runId, recId } = await pendingRec();
    try {
      const res = await decisionPOST(
        decisionBody({
          action: "OVERRIDE",
          note: "overriding without a play named",
          idempotencyKey: "idem-nop",
        })(recId),
        postCtx(recId),
      );
      expect(res.status).toBe(400);
      expect((await res.json()).error.code).toBe("OVERRIDE_PLAY_REQUIRED");
    } finally {
      await cleanupRunAndRecs(runId);
    }
  });

  it("malformed JSON body → 400 VALIDATION_ERROR", async () => {
    mockAuth.mockResolvedValue(realSession(await seededUser("buyer@pdi.test"), "buyer"));
    const req = new NextRequest(
      `http://localhost:3000/api/recommendations/${unknownId}/decision`,
      { method: "POST", headers: { "content-type": "application/json" }, body: "{ not json" },
    );
    const res = await decisionPOST(req, postCtx(unknownId));
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe("VALIDATION_ERROR");
  });

  // --- decide-once + idempotency (F6-ERR1 / F6-ERR3) ---

  it("F6-ERR1: a second decision (different key) → 409 ALREADY_DECIDED naming the decider, no dup row", async () => {
    const buyer = await seededUser("buyer@pdi.test");
    mockAuth.mockResolvedValue(realSession(buyer, "buyer"));
    const { runId, recId } = await pendingRec();
    try {
      const first = await decisionPOST(
        decisionBody({ action: "APPROVE", note: "", idempotencyKey: "idem-first" })(recId),
        postCtx(recId),
      );
      expect(first.status).toBe(201);
      const afterFirst = await decisionCount();

      const second = await decisionPOST(
        decisionBody({ action: "REJECT", note: "changed my mind now", idempotencyKey: "idem-second" })(recId),
        postCtx(recId),
      );
      const body = await second.json();
      expect(second.status).toBe(409);
      expect(body.error.code).toBe("ALREADY_DECIDED");
      expect(body.error.message).toContain(buyer.email);

      expect(await decisionCount()).toBe(afterFirst);
      const [rec] = await getSql()`select status from recommendations where id = ${recId}`;
      expect(rec.status).toBe("APPROVED");
    } finally {
      await cleanupRunAndRecs(runId);
    }
  });

  it("F6-ERR3: same idempotencyKey re-POST → success with the existing decision, no duplicate row", async () => {
    mockAuth.mockResolvedValue(realSession(await seededUser("buyer@pdi.test"), "buyer"));
    const { runId, recId } = await pendingRec();
    try {
      const key = "idem-retry-once";
      const first = await decisionPOST(
        decisionBody({ action: "APPROVE", note: "", idempotencyKey: key })(recId),
        postCtx(recId),
      );
      const firstBody = await first.json();
      expect(first.status).toBe(201);
      const afterFirst = await decisionCount();

      const retry = await decisionPOST(
        decisionBody({ action: "APPROVE", note: "", idempotencyKey: key })(recId),
        postCtx(recId),
      );
      const retryBody = await retry.json();
      expect(retry.status).toBe(201);
      expect(retryBody.success).toBe(true);
      expect(retryBody.data.decision.id).toBe(firstBody.data.decision.id);

      expect(await decisionCount()).toBe(afterFirst);
    } finally {
      await cleanupRunAndRecs(runId);
    }
  });

  it("EXPIRED recommendation → 409 DECISION_NOT_ALLOWED", async () => {
    mockAuth.mockResolvedValue(realSession(await seededUser("buyer@pdi.test"), "buyer"));
    const runId = await insertRun();
    const recId = await insertRecommendation({
      runId,
      materialCode: "WR-8-MS",
      plantCode: "HSP",
      play: "WAIT",
      status: "EXPIRED",
    });
    try {
      const res = await decisionPOST(
        decisionBody({ action: "APPROVE", note: "", idempotencyKey: "idem-expired" })(recId),
        postCtx(recId),
      );
      expect(res.status).toBe(409);
      expect((await res.json()).error.code).toBe("DECISION_NOT_ALLOWED");
    } finally {
      await cleanupRunAndRecs(runId);
    }
  });

  it("two concurrent decisions on one rec → exactly one 201, one 409, one row (FOR UPDATE)", async () => {
    mockAuth.mockResolvedValue(realSession(await seededUser("buyer@pdi.test"), "buyer"));
    const { runId, recId } = await pendingRec();
    try {
      const before = await decisionCount();
      const [a, b] = await Promise.all([
        decisionPOST(
          decisionBody({ action: "APPROVE", note: "", idempotencyKey: "idem-race-a" })(recId),
          postCtx(recId),
        ),
        decisionPOST(
          decisionBody({ action: "REJECT", note: "racing the approval", idempotencyKey: "idem-race-b" })(recId),
          postCtx(recId),
        ),
      ]);

      const statuses = [a.status, b.status].sort();
      expect(statuses).toEqual([201, 409]);
      expect(await decisionCount()).toBe(before + 1);
    } finally {
      await cleanupRunAndRecs(runId);
    }
  });
});
