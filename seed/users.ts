import bcrypt from "bcryptjs";
import type postgres from "postgres";

// FIX-1 test users (PRD §10). One per RBAC role.
//
// SECURITY: this is a test-only password and, per the PRD, it deliberately lives
// here in the seed. ROTATE IT (and reseed) for any client-facing deploy — these
// credentials are for local demo/CI only and must never guard real data.
export const TEST_USER_PASSWORD = "pdi-demo-2026";

const BCRYPT_COST = 10;

export const SEED_USERS = [
  { email: "viewer@pdi.test", role: "viewer" },
  { email: "buyer@pdi.test", role: "buyer" },
  { email: "approver@pdi.test", role: "approver" },
  { email: "admin@pdi.test", role: "admin" },
] as const;

export type SeededUsers = {
  byRole: Record<(typeof SEED_USERS)[number]["role"], string>;
  adminId: string;
};

/** Inserts the four FIX-1 users with bcrypt(cost 10) hashes; returns their ids. */
export async function seedUsers(sql: postgres.Sql): Promise<SeededUsers> {
  const hash = await bcrypt.hash(TEST_USER_PASSWORD, BCRYPT_COST);
  const rows = SEED_USERS.map((u) => ({
    email: u.email,
    password_hash: hash,
    role: u.role,
  }));
  const inserted = await sql`
    insert into users ${sql(rows, "email", "password_hash", "role")}
    returning id, role`;

  const byRole = {} as SeededUsers["byRole"];
  for (const r of inserted) {
    byRole[r.role as keyof SeededUsers["byRole"]] = r.id as string;
  }
  return { byRole, adminId: byRole.admin };
}
