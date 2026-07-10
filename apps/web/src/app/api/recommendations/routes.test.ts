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
