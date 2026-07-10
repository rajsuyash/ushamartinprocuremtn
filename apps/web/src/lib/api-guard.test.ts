import type { Session } from "next-auth";
import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { Role } from "@/auth/access";

import { withApiAuth } from "./api-guard";

vi.mock("@/auth", () => ({ auth: vi.fn() }));

const { auth } = await import("@/auth");
const mockAuth = vi.mocked(auth as unknown as () => Promise<Session | null>);

function sessionFor(role: Role): Session {
  return {
    user: { id: "11111111-1111-1111-1111-111111111111", email: `${role}@pdi.test`, role },
    expires: new Date(Date.now() + 3_600_000).toISOString(),
  } as Session;
}

const req = () => new NextRequest("http://localhost:3000/api/recommendations");

describe("withApiAuth (per-route guard, PRD F1)", () => {
  afterEach(() => {
    vi.clearAllMocks();
    vi.restoreAllMocks();
  });

  it("returns the exact 401 UNAUTHENTICATED envelope with no session", async () => {
    mockAuth.mockResolvedValue(null);
    const handler = vi.fn();
    const res = await withApiAuth(handler, { roles: "authenticated" })(req());

    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({
      success: false,
      data: null,
      error: { code: "UNAUTHENTICATED", message: "Authentication required." },
    });
    expect(handler).not.toHaveBeenCalled();
  });

  it("treats a session whose user has no id as unauthenticated", async () => {
    mockAuth.mockResolvedValue({ user: undefined } as unknown as Session);
    const res = await withApiAuth(vi.fn(), { roles: "authenticated" })(req());
    expect(res.status).toBe(401);
  });

  it("403 FORBIDDEN_ROLE when the session role is not in opts.roles", async () => {
    mockAuth.mockResolvedValue(sessionFor("viewer"));
    const handler = vi.fn();
    const res = await withApiAuth(handler, { roles: ["buyer", "approver", "admin"] })(
      req(),
    );

    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.success).toBe(false);
    expect(body.error.code).toBe("FORBIDDEN_ROLE");
    expect(handler).not.toHaveBeenCalled();
  });

  it("roles undefined admits any authenticated role", async () => {
    for (const role of ["viewer", "buyer", "approver", "admin"] as const) {
      mockAuth.mockResolvedValue(sessionFor(role));
      const res = await withApiAuth(async () => Response.json({ hit: role }), { roles: "authenticated" })(req());
      expect(res.status).toBe(200);
    }
  });

  it("roles: [] fails closed — denies every role", async () => {
    mockAuth.mockResolvedValue(sessionFor("admin"));
    const res = await withApiAuth(vi.fn(), { roles: [] })(req());
    expect(res.status).toBe(403);
  });

  it("passes the session (and params) through to the handler", async () => {
    mockAuth.mockResolvedValue(sessionFor("buyer"));
    const handler = vi.fn(async (_req: NextRequest, ctx: { session: Session }) =>
      Response.json({ id: ctx.session.user.id }),
    );
    const res = await withApiAuth(handler, { roles: ["buyer"] })(req());
    expect(await res.json()).toEqual({
      id: "11111111-1111-1111-1111-111111111111",
    });
  });

  it("a throwing handler yields 500 INTERNAL with no stack trace in the body", async () => {
    mockAuth.mockResolvedValue(sessionFor("buyer"));
    const logSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await withApiAuth(
      async () => {
        throw new Error("secret db detail");
      },
      { roles: "authenticated" },
    )(req());

    expect(res.status).toBe(500);
    const raw = await res.text();
    expect(JSON.parse(raw)).toEqual({
      success: false,
      data: null,
      error: { code: "INTERNAL", message: "Internal server error." },
    });
    expect(raw).not.toContain("secret db detail");
    expect(raw).not.toContain("at "); // no stack frames

    // Structured server-side log carries request id, user id, path.
    const logged = JSON.parse(logSpy.mock.calls[0][0] as string);
    expect(logged).toMatchObject({
      level: "error",
      userId: "11111111-1111-1111-1111-111111111111",
      path: "/api/recommendations",
      message: "secret db detail",
    });
    expect(logged.requestId).toBeTruthy();
  });
});
