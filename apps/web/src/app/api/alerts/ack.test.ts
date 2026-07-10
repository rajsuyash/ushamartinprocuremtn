import type { Session } from "next-auth";
import { NextRequest } from "next/server";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";

import type { Role } from "@/auth/access";
import { getSql } from "@/db/client";

import { POST as ackPOST } from "./[id]/ack/route";
import { GET as alertsGET } from "./route";

// Integration tests for F7-AC1/AC2/ERR1 (GET /api/alerts + POST /:id/ack). Route
// handlers invoked directly (no Next server) with auth() mocked, fixtures against
// the live compose postgres (DATABASE_URL required, localhost:5442) — same
// pattern as recommendations/routes.test.ts.

vi.mock("@/auth", () => ({ auth: vi.fn() }));

const { auth } = await import("@/auth");
const mockAuth = vi.mocked(auth as unknown as () => Promise<Session | null>);

function sessionFor(role: Role): Session {
  return {
    user: { id: "22222222-2222-2222-2222-222222222222", email: `${role}@pdi.test`, role },
    expires: new Date(Date.now() + 3_600_000).toISOString(),
  } as Session;
}

async function seededUser(email: string): Promise<{ id: string; email: string }> {
  const [row] = await getSql()`select id, email from users where email = ${email}`;
  return { id: row.id as string, email: row.email as string };
}

// A session whose user.id is a REAL seeded user — alerts.acked_by FK requires it.
function realSession(user: { id: string; email: string }, role: Role): Session {
  return {
    user: { id: user.id, email: user.email, role },
    expires: new Date(Date.now() + 3_600_000).toISOString(),
  } as Session;
}

const getReq = (qs = "") => new NextRequest(`http://localhost:3000/api/alerts${qs}`);
const postReq = (id: string) =>
  new NextRequest(`http://localhost:3000/api/alerts/${id}/ack`, { method: "POST" });
const postCtx = (id: string) => ({ params: Promise.resolve({ id }) });

async function insertRun(): Promise<string> {
  // Mark DONE up front — a bare QUEUED/RUNNING row would trip the global
  // "one run at a time" 409 invariant in runs.test.ts's concurrent suite.
  const [row] = await getSql()`insert into runs (status) values ('DONE') returning id`;
  return row.id as string;
}

async function insertAlert(params: {
  runId: string;
  type?: string;
  severity?: string;
  materialCode?: string;
  plantCode?: string;
  payload?: unknown;
  status?: string;
}): Promise<string> {
  const sql = getSql();
  const material = params.materialCode
    ? (await sql`select id from materials where code = ${params.materialCode}`)[0]
    : null;
  const plant = params.plantCode
    ? (await sql`select id from plants where code = ${params.plantCode}`)[0]
    : null;
  const [row] = await sql`
    insert into alerts (run_id, type, severity, material_id, plant_id, payload, status)
    values (
      ${params.runId}, ${params.type ?? "COVER_BREACH"}, ${params.severity ?? "CRITICAL"},
      ${material?.id ?? null}, ${plant?.id ?? null},
      ${JSON.stringify(params.payload ?? {})}::jsonb, ${params.status ?? "OPEN"}
    )
    returning id
  `;
  return row.id as string;
}

async function cleanupRunAndAlerts(runId: string): Promise<void> {
  const sql = getSql();
  await sql`delete from alerts where run_id = ${runId}`;
  await sql`delete from runs where id = ${runId}`;
}

afterEach(() => vi.clearAllMocks());
afterAll(async () => {
  await getSql().end();
});

describe("GET /api/alerts", () => {
  it("no session → 401 UNAUTHENTICATED", async () => {
    mockAuth.mockResolvedValue(null);
    const res = await alertsGET(getReq());
    expect(res.status).toBe(401);
    expect((await res.json()).error.code).toBe("UNAUTHENTICATED");
  });

  it("viewer can list (VIEW = all four roles)", async () => {
    mockAuth.mockResolvedValue(sessionFor("viewer"));
    const res = await alertsGET(getReq());
    expect(res.status).toBe(200);
    expect((await res.json()).success).toBe(true);
  });

  it("filters by status=OPEN vs ACKED", async () => {
    mockAuth.mockResolvedValue(sessionFor("buyer"));
    const runId = await insertRun();
    try {
      const openId = await insertAlert({ runId, materialCode: "WR-5.5-HC", plantCode: "RNC" });
      const ackedId = await insertAlert({ runId, status: "ACKED" });

      const openRes = await alertsGET(getReq("?status=OPEN"));
      const openIds = (await openRes.json()).data.alerts.map((a: { id: string }) => a.id);
      expect(openIds).toContain(openId);
      expect(openIds).not.toContain(ackedId);

      const ackedRes = await alertsGET(getReq("?status=ACKED"));
      const ackedIds = (await ackedRes.json()).data.alerts.map((a: { id: string }) => a.id);
      expect(ackedIds).toContain(ackedId);
      expect(ackedIds).not.toContain(openId);
    } finally {
      await cleanupRunAndAlerts(runId);
    }
  });

  it("F7-AC1: COVER_BREACH row carries material/plant + recommendationId payload through", async () => {
    mockAuth.mockResolvedValue(sessionFor("buyer"));
    const runId = await insertRun();
    try {
      const alertId = await insertAlert({
        runId,
        materialCode: "WR-5.5-HC",
        plantCode: "RNC",
        payload: { coverDays: 16.6, minCoverDays: 21, recommendationId: "rec-fixture" },
      });
      const res = await alertsGET(getReq());
      const body = await res.json();
      const row = body.data.alerts.find((a: { id: string }) => a.id === alertId);

      expect(row).toMatchObject({
        type: "COVER_BREACH",
        severity: "CRITICAL",
        materialCode: "WR-5.5-HC",
        plantCode: "RNC",
        status: "OPEN",
        payload: { coverDays: 16.6, minCoverDays: 21, recommendationId: "rec-fixture" },
      });
    } finally {
      await cleanupRunAndAlerts(runId);
    }
  });

  it("defaults to a bounded limit (pagination pitfall)", async () => {
    mockAuth.mockResolvedValue(sessionFor("buyer"));
    const res = await alertsGET(getReq("?limit=not-a-number"));
    expect(res.status).toBe(200);
    expect((await res.json()).success).toBe(true);
  });
});

describe("POST /api/alerts/:id/ack", () => {
  const unknownId = "33333333-3333-3333-3333-333333333333";

  it("no session → 401 UNAUTHENTICATED", async () => {
    mockAuth.mockResolvedValue(null);
    const res = await ackPOST(postReq(unknownId), postCtx(unknownId));
    expect(res.status).toBe(401);
    expect((await res.json()).error.code).toBe("UNAUTHENTICATED");
  });

  it("viewer → 403 FORBIDDEN_ROLE, no state change possible", async () => {
    mockAuth.mockResolvedValue(sessionFor("viewer"));
    const res = await ackPOST(postReq(unknownId), postCtx(unknownId));
    expect(res.status).toBe(403);
    expect((await res.json()).error.code).toBe("FORBIDDEN_ROLE");
  });

  it("unknown alert → 404 NOT_FOUND", async () => {
    mockAuth.mockResolvedValue(realSession(await seededUser("buyer@pdi.test"), "buyer"));
    const res = await ackPOST(postReq(unknownId), postCtx(unknownId));
    expect(res.status).toBe(404);
    expect((await res.json()).error.code).toBe("NOT_FOUND");
  });

  it("F7-AC2: ack an OPEN alert → 200, status ACKED, actor + timestamp recorded", async () => {
    const buyer = await seededUser("buyer@pdi.test");
    mockAuth.mockResolvedValue(realSession(buyer, "buyer"));
    const runId = await insertRun();
    try {
      const alertId = await insertAlert({ runId });
      const res = await ackPOST(postReq(alertId), postCtx(alertId));
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.success).toBe(true);
      expect(body.data.alert).toMatchObject({ id: alertId, status: "ACKED", ackedByEmail: buyer.email });

      const [row] = await getSql()`select status, acked_by, acked_at from alerts where id = ${alertId}`;
      expect(row.status).toBe("ACKED");
      expect(row.acked_by).toBe(buyer.id);
      expect(row.acked_at).not.toBeNull();
    } finally {
      await cleanupRunAndAlerts(runId);
    }
  });

  it("F7-ERR1: second ack on an already-acked alert → 409 ALREADY_ACKED naming the acker, no state change", async () => {
    const buyer = await seededUser("buyer@pdi.test");
    const runId = await insertRun();
    try {
      const alertId = await insertAlert({ runId });

      mockAuth.mockResolvedValue(realSession(buyer, "buyer"));
      const first = await ackPOST(postReq(alertId), postCtx(alertId));
      expect(first.status).toBe(200);

      mockAuth.mockResolvedValue(realSession(await seededUser("approver@pdi.test"), "approver"));
      const second = await ackPOST(postReq(alertId), postCtx(alertId));
      const body = await second.json();

      expect(second.status).toBe(409);
      expect(body.error.code).toBe("ALREADY_ACKED");
      expect(body.error.message).toContain(buyer.email);

      const [row] = await getSql()`select acked_by from alerts where id = ${alertId}`;
      expect(row.acked_by).toBe(buyer.id);
    } finally {
      await cleanupRunAndAlerts(runId);
    }
  });

  it("two concurrent acks on one alert → exactly one 200, one 409", async () => {
    mockAuth.mockResolvedValue(realSession(await seededUser("buyer@pdi.test"), "buyer"));
    const runId = await insertRun();
    try {
      const alertId = await insertAlert({ runId });
      const [a, b] = await Promise.all([
        ackPOST(postReq(alertId), postCtx(alertId)),
        ackPOST(postReq(alertId), postCtx(alertId)),
      ]);
      const statuses = [a.status, b.status].sort();
      expect(statuses).toEqual([200, 409]);
    } finally {
      await cleanupRunAndAlerts(runId);
    }
  });
});
