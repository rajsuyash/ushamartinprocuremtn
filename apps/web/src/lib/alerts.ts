import { and, eq } from "drizzle-orm";

import { getDb } from "@/db/client";
import { alerts, users } from "@/db/schema";

// F7 alert acknowledgement (PRD §6 F7 route table: POST /api/alerts/:id/ack).
// Unlike F6 decisions (multi-branch idempotency-key logic in lib/decisions.ts),
// ack has no retry/idempotency contract in the PRD — a single
// `UPDATE ... WHERE status = 'OPEN' RETURNING` is already the atomic
// ack-once check: the WHERE clause makes two concurrent acks race safely to
// "exactly one wins" without a separate SELECT ... FOR UPDATE lock.

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface AlertAckView {
  id: string;
  status: "ACKED";
  ackedBy: string;
  ackedByEmail: string;
  ackedAt: string;
}

export type AckResult =
  | { ok: true; alert: AlertAckView }
  | { ok: false; code: "NOT_FOUND" }
  | { ok: false; code: "ALREADY_ACKED"; ackedByEmail: string };

export interface AckAlertInput {
  alertId: string;
  userId: string;
  userEmail: string;
}

/** Acknowledge an OPEN alert (F7-AC2). 409 ALREADY_ACKED (F7-ERR1) if it was
 * already acked by anyone (including a race); 404 for an unknown/malformed id. */
export async function ackAlert(input: AckAlertInput): Promise<AckResult> {
  if (!UUID_RE.test(input.alertId)) return { ok: false, code: "NOT_FOUND" };

  const db = getDb();
  const now = new Date();
  const [updated] = await db
    .update(alerts)
    .set({ status: "ACKED", ackedBy: input.userId, ackedAt: now })
    .where(and(eq(alerts.id, input.alertId), eq(alerts.status, "OPEN")))
    .returning({ id: alerts.id, ackedAt: alerts.ackedAt });

  if (updated) {
    return {
      ok: true,
      alert: {
        id: updated.id,
        status: "ACKED",
        ackedBy: input.userId,
        ackedByEmail: input.userEmail,
        ackedAt: (updated.ackedAt as Date).toISOString(),
      },
    };
  }

  // The UPDATE matched nothing: either the id doesn't exist, or it's already
  // ACKED (by this request losing a race, or a prior request) — disambiguate.
  const [existing] = await db
    .select({ status: alerts.status, ackedByEmail: users.email })
    .from(alerts)
    .leftJoin(users, eq(users.id, alerts.ackedBy))
    .where(eq(alerts.id, input.alertId))
    .limit(1);

  if (!existing) return { ok: false, code: "NOT_FOUND" };
  return {
    ok: false,
    code: "ALREADY_ACKED",
    ackedByEmail: existing.ackedByEmail ?? "another user",
  };
}
