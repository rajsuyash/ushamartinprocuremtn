import type { Session } from "next-auth";
import { NextRequest } from "next/server";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Role } from "@/auth/access";
import { getSql } from "@/db/client";

// F10 route contract tests: auth gate, input validation, NO_COMPLETED_RUN, and
// engine proxy outcomes (down -> ENGINE_UNAVAILABLE, 4xx -> SIMULATION_FAILED,
// 200 -> passthrough envelope). Engine fetch mocked; run rows are real DB rows.
vi.mock("@/auth", () => ({ auth: vi.fn() }));

const { auth } = await import("@/auth");
const { POST } = await import("./route");

const mockAuth = vi.mocked(auth as unknown as () => Promise<Session | null>);
const fetchSpy = vi.spyOn(globalThis, "fetch");

function sessionFor(role: Role): Session {
  return {
    user: { id: "44444444-4444-4444-4444-444444444444", email: `${role}@pdi.test`, role },
    expires: new Date(Date.now() + 3_600_000).toISOString(),
  } as Session;
}

const validBody = {
  materialCode: "WR-5.5-HC",
  plantCode: "RNC",
  overrides: { minCoverDays: 30 },
};

function postReq(body: unknown = validBody): NextRequest {
  return new NextRequest("http://localhost:3000/api/simulate", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

const createdRunIds: string[] = [];

async function createDoneRun(): Promise<string> {
  const [row] = await getSql()`
    insert into runs (status, finished_at) values ('DONE', now()) returning id
  `;
  createdRunIds.push(row.id as string);
  return row.id as string;
}

beforeEach(() => {
  mockAuth.mockResolvedValue(sessionFor("buyer"));
  process.env.ENGINE_URL = "http://engine.test:8000";
});

afterEach(async () => {
  vi.clearAllMocks();
  if (createdRunIds.length > 0) {
    await getSql()`delete from runs where id = any(${createdRunIds})`;
    createdRunIds.length = 0;
  }
});

afterAll(async () => {
  await getSql().end();
});

describe("POST /api/simulate", () => {
  it("no session -> 401 UNAUTHENTICATED", async () => {
    mockAuth.mockResolvedValue(null);
    const res = await POST(postReq());
    expect(res.status).toBe(401);
    expect((await res.json()).error.code).toBe("UNAUTHENTICATED");
  });

  it("viewer -> 403 FORBIDDEN_ROLE", async () => {
    mockAuth.mockResolvedValue(sessionFor("viewer"));
    const res = await POST(postReq());
    expect(res.status).toBe(403);
    expect((await res.json()).error.code).toBe("FORBIDDEN_ROLE");
  });

  it("invalid body -> 400 VALIDATION_ERROR, engine never called", async () => {
    const res = await POST(postReq({ materialCode: "", overrides: { priceShiftPct: 99 } }));
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe("VALIDATION_ERROR");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("no DONE run -> 409 NO_COMPLETED_RUN", async () => {
    // Relies on the suite DB having no DONE runs of its own creation; scope the
    // check by deleting nothing — instead flip existing DONE runs? No: cheaper
    // and safe — temporarily mark DONE runs as FAILED and restore after.
    const sql = getSql();
    const demoted = await sql`
      update runs set status = 'FAILED' where status = 'DONE' returning id
    `;
    try {
      const res = await POST(postReq());
      expect(res.status).toBe(409);
      expect((await res.json()).error.code).toBe("NO_COMPLETED_RUN");
    } finally {
      const ids = demoted.map((r) => r.id as string);
      if (ids.length > 0) {
        await sql`update runs set status = 'DONE' where id = any(${ids})`;
      }
    }
  });

  it("engine unreachable -> 502 ENGINE_UNAVAILABLE", async () => {
    await createDoneRun();
    fetchSpy.mockRejectedValueOnce(new Error("ECONNREFUSED"));
    const res = await POST(postReq());
    expect(res.status).toBe(502);
    expect((await res.json()).error.code).toBe("ENGINE_UNAVAILABLE");
  });

  it("engine 422 -> 422 SIMULATION_FAILED with engineCode detail", async () => {
    await createDoneRun();
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify({ detail: { code: "UNKNOWN_MATERIAL" } }), { status: 422 }),
    );
    const res = await POST(postReq());
    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.error.code).toBe("SIMULATION_FAILED");
    expect(body.error.detail.engineCode).toBe("UNKNOWN_MATERIAL");
  });

  it("engine 200 -> 200 ok(result), snake_case overrides forwarded", async () => {
    const runId = await createDoneRun();
    const engineResult = { baseline: {}, simulated: {}, deltas: null, overridesApplied: {}, policy: {} };
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify(engineResult), { status: 200 }),
    );

    const res = await POST(postReq());
    expect(res.status).toBe(200);
    expect((await res.json()).success).toBe(true);

    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://engine.test:8000/v1/simulate");
    const sent = JSON.parse(init.body as string);
    expect(sent.run_id).toBe(runId);
    expect(sent.material_code).toBe("WR-5.5-HC");
    expect(sent.overrides.min_cover_days).toBe(30);
  });
});
