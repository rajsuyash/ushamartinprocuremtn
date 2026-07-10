import bcrypt from "bcryptjs";
import { eq } from "drizzle-orm";

import { getDb } from "../db/client";
import { users } from "../db/schema";
import type { Role } from "./access";

export type AuthorizedUser = { id: string; email: string; role: Role };

type RawCredentials = Partial<Record<"email" | "password", unknown>>;

// Valid bcrypt hash of an unguessable throwaway string. Compared against on the
// unknown-email branch so known and unknown emails pay the same bcrypt cost —
// without it, response latency enumerates accounts even when bodies match.
const TIMING_EQUALIZATION_HASH =
  "$2b$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy";

/**
 * Credentials authorize (PRD F1). Node-only: reads the users table (parameterized via
 * drizzle) and bcrypt-compares. Returns the user on success (role included) or null on
 * ANY failure — wrong password, unknown email, and empty input all yield the same
 * generic null so callers cannot enumerate users. Successful sign-in bumps
 * last_login_at. Failed attempts are logged (email + timestamp, never the password).
 */
export async function authorizeCredentials(
  creds: RawCredentials,
): Promise<AuthorizedUser | null> {
  const email =
    typeof creds.email === "string" ? creds.email.trim().toLowerCase() : "";
  const password = typeof creds.password === "string" ? creds.password : "";

  // Empty input short-circuits before any bcrypt work or DB hit.
  if (!email || !password) {
    logFailedAttempt(email || "(empty)");
    return null;
  }

  const db = getDb();
  const [user] = await db
    .select({
      id: users.id,
      email: users.email,
      role: users.role,
      passwordHash: users.passwordHash,
    })
    .from(users)
    .where(eq(users.email, email))
    .limit(1);

  if (!user) {
    await bcrypt.compare(password, TIMING_EQUALIZATION_HASH);
    logFailedAttempt(email);
    return null;
  }

  const ok = await bcrypt.compare(password, user.passwordHash);
  if (!ok) {
    logFailedAttempt(email);
    return null;
  }

  await db
    .update(users)
    .set({ lastLoginAt: new Date() })
    .where(eq(users.id, user.id));

  return { id: user.id, email: user.email, role: user.role };
}

function logFailedAttempt(email: string): void {
  // Structured line for later log aggregation. Never includes the password.
  console.warn(
    JSON.stringify({
      event: "auth.failed_attempt",
      email,
      at: new Date().toISOString(),
    }),
  );
}
