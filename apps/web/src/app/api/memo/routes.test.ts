import type { Session } from "next-auth";
import { NextRequest } from "next/server";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";

import type { Role } from "@/auth/access";
import { getSql } from "@/db/client";

import { POST as memoPOST } from "./route";

// Integration tests for T32 (PRD §6 F9 routes table + F9-ERR1 template mode).
// Route handler invoked directly (no Next server) with auth() mocked, same pattern
// as recommendations/routes.test.ts.

vi.mock("@/auth", () => ({ auth: vi.fn() }));

const { auth } = await import("@/auth");
const mockAuth = vi.mocked(auth as unknown as () => Promise<Session | null>);

function sessionFor(role: Role): Session {
  return {
    user: { id: "22222222-2222-2222-2222-222222222222", email: `${role}@pdi.test`, role },
    expires: new Date(Date.now() + 3_600_000).toISOString(),
  } as Session;
}

// The POST handler writes memos.created_by, which FK-references users(id) — the
// hardcoded id in sessionFor() would violate that FK, so the write path needs a
// REAL seeded user (same pattern as recommendations/routes.test.ts realSession()).
async function realBuyerSession(): Promise<Session> {
  const [row] = await getSql()`select id, email from users where email = 'buyer@pdi.test'`;
  return {
    user: { id: row.id as string, email: row.email as string, role: "buyer" },
    expires: new Date(Date.now() + 3_600_000).toISOString(),
  } as Session;
}

const postReq = () => new NextRequest("http://localhost:3000/api/memo", { method: "POST" });

const sql = getSql();

afterEach(() => {
  vi.mocked(auth).mockReset();
});

afterAll(async () => {
  await sql.end();
});

describe("POST /api/memo (T32)", () => {
  it("viewer -> 403 FORBIDDEN_ROLE, no memo stored", async () => {
    mockAuth.mockResolvedValue(sessionFor("viewer"));
    const [before] = await sql`select count(*)::int as n from memos`;

    const res = await memoPOST(postReq());
    const body = await res.json();

    expect(res.status).toBe(403);
    expect(body).toMatchObject({ success: false, error: { code: "FORBIDDEN_ROLE" } });

    const [after] = await sql`select count(*)::int as n from memos`;
    expect(after.n).toBe(before.n);
  });

  it("no session -> 401 UNAUTHENTICATED", async () => {
    mockAuth.mockResolvedValue(null);
    const res = await memoPOST(postReq());
    const body = await res.json();

    expect(res.status).toBe(401);
    expect(body).toMatchObject({ success: false, error: { code: "UNAUTHENTICATED" } });
  });

  it("buyer, ANTHROPIC_API_KEY unset -> 200 TEMPLATE mode, memo stored (F9-ERR1)", async () => {
    mockAuth.mockResolvedValue(await realBuyerSession());
    const savedKey = process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;

    try {
      const res = await memoPOST(postReq());
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.success).toBe(true);
      expect(body.data.mode).toBe("TEMPLATE");
      expect(body.data.memo.mode).toBe("TEMPLATE");
      expect(body.data.memo.modelId).toBeNull();
      expect(body.data.memo.content.headline).toEqual(expect.any(String));
      expect(body.data.memo.content.keyNumbers.length).toBeGreaterThan(0);

      const [stored] = await sql`select mode, model_id from memos where id = ${body.data.memo.id}`;
      expect(stored.mode).toBe("TEMPLATE");
      expect(stored.model_id).toBeNull();

      await sql`delete from memos where id = ${body.data.memo.id}`;
    } finally {
      if (savedKey !== undefined) process.env.ANTHROPIC_API_KEY = savedKey;
    }
  });
});
