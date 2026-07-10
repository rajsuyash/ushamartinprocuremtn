import { randomUUID } from "node:crypto";

import bcrypt from "bcryptjs";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// Import the fixture password from the seed — never hardcode it (per task contract).
import { TEST_USER_PASSWORD } from "../../../../seed/users";
import { getSql } from "../db/client";
import { authorizeCredentials } from "./authorize";

// Integration-style: runs against the live compose postgres (DATABASE_URL derived).
// We provision a throwaway user with a real bcrypt hash so the mutating paths
// (last_login_at) never touch the shared FIX-1 rows; one read-only assertion still
// proves a genuine FIX-1 credential (buyer@pdi.test) authorizes.

const TEMP_EMAIL = `t6auth_${randomUUID().slice(0, 8)}@pdi.test`;

beforeAll(async () => {
  const sql = getSql();
  const hash = await bcrypt.hash(TEST_USER_PASSWORD, 10);
  await sql`
    insert into users (email, password_hash, role)
    values (${TEMP_EMAIL}, ${hash}, 'buyer')`;
});

afterAll(async () => {
  const sql = getSql();
  await sql`delete from users where email = ${TEMP_EMAIL}`;
  await sql.end();
});

describe("authorizeCredentials (PRD F1)", () => {
  it("returns the user (with role) for valid credentials", async () => {
    const user = await authorizeCredentials({
      email: TEMP_EMAIL,
      password: TEST_USER_PASSWORD,
    });
    expect(user).not.toBeNull();
    expect(user?.email).toBe(TEMP_EMAIL);
    expect(user?.role).toBe("buyer");
    expect(user?.id).toEqual(expect.any(String));
  });

  it("authorizes a real seeded FIX-1 credential", async () => {
    const user = await authorizeCredentials({
      email: "buyer@pdi.test",
      password: TEST_USER_PASSWORD,
    });
    expect(user?.role).toBe("buyer");
  });

  it("returns null and logs an attempt on wrong password", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const user = await authorizeCredentials({
      email: TEMP_EMAIL,
      password: "definitely-wrong",
    });
    expect(user).toBeNull();
    expect(warn).toHaveBeenCalledTimes(1);
    const logged = warn.mock.calls[0]?.[0] as string;
    expect(logged).toContain(TEMP_EMAIL);
    expect(logged).not.toContain("definitely-wrong");
    warn.mockRestore();
  });

  it("returns null for an unknown email (no user-enumeration difference)", async () => {
    const user = await authorizeCredentials({
      email: `nobody_${randomUUID()}@pdi.test`,
      password: TEST_USER_PASSWORD,
    });
    expect(user).toBeNull();
  });

  it("returns null for an empty password without calling bcrypt", async () => {
    const compare = vi.spyOn(bcrypt, "compare");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const user = await authorizeCredentials({ email: TEMP_EMAIL, password: "" });
    expect(user).toBeNull();
    expect(compare).not.toHaveBeenCalled();
    compare.mockRestore();
    warn.mockRestore();
  });

  it("updates last_login_at on successful sign-in", async () => {
    const sql = getSql();
    // Reset to null first so the assertion is deterministic regardless of test order.
    await sql`update users set last_login_at = null where email = ${TEMP_EMAIL}`;
    const [before] = await sql`
      select last_login_at from users where email = ${TEMP_EMAIL}`;
    expect(before.last_login_at).toBeNull();

    await authorizeCredentials({
      email: TEMP_EMAIL,
      password: TEST_USER_PASSWORD,
    });

    const [after] = await sql`
      select last_login_at from users where email = ${TEMP_EMAIL}`;
    // Went from null → a concrete timestamp; the driver may hand it back as a Date or
    // an ISO-ish string, so assert on presence rather than the JS wrapper type.
    expect(after.last_login_at).not.toBeNull();
  });
});
