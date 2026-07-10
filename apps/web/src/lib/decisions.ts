import type { DecisionActionInput, Play } from "@pdi/shared";
import { eq } from "drizzle-orm";

import { getDb } from "@/db/client";
import { decisionRecords, recommendations, users } from "@/db/schema";

// F6 decision write (PRD §6 F6 + §7 E14). Mirrors staging.ts: the route stays a thin
// envelope shell, all state logic lives here and returns a discriminated result.
//
// Invariants enforced:
//   - DecisionRecord is append-only — this module only INSERTs it (never UPDATE/DELETE).
//   - Decide-once — a recommendation is decided at most once. Enforced by a
//     SELECT ... FOR UPDATE lock on the recommendation row (serializes concurrent
//     deciders) with UNIQUE(recommendation_id) as the DB backstop.
//   - Idempotent retry (F6-ERR3) — the same idempotencyKey re-POST returns the existing
//     decision without a second row; UNIQUE(idempotency_key) is the backstop.

type Db = ReturnType<typeof getDb>;
type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// action → the recommendation status the decision flips it to (PRD §7 E13 transitions).
const STATUS_FOR_ACTION: Record<DecisionActionInput, "APPROVED" | "OVERRIDDEN" | "REJECTED"> =
  {
    APPROVE: "APPROVED",
    OVERRIDE: "OVERRIDDEN",
    REJECT: "REJECTED",
  };

export interface DecisionView {
  id: string;
  recommendationId: string;
  action: DecisionActionInput;
  note: string;
  override: { play: Play } | null;
  decidedBy: string;
  decidedByEmail: string;
  decidedAt: string;
}

export interface RecordDecisionInput {
  recommendationId: string;
  userId: string;
  userEmail: string;
  action: DecisionActionInput;
  note: string;
  override: { play: Play } | null;
  idempotencyKey: string;
}

export type DecisionResult =
  | { ok: true; created: boolean; decision: DecisionView; status: string }
  | { ok: false; code: "NOT_FOUND" }
  | { ok: false; code: "ALREADY_DECIDED"; decidedByEmail: string }
  | { ok: false; code: "DECISION_NOT_ALLOWED"; status: string };

const DECIDED_STATUSES = new Set(["APPROVED", "OVERRIDDEN", "REJECTED"]);

function isUniqueViolation(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    (err as { code?: unknown }).code === "23505"
  );
}

function toView(row: {
  id: string;
  recommendationId: string;
  action: DecisionActionInput;
  note: string;
  override: unknown;
  decidedBy: string;
  decidedByEmail: string;
  decidedAt: Date | string;
}): DecisionView {
  return {
    id: row.id,
    recommendationId: row.recommendationId,
    action: row.action,
    note: row.note,
    override: (row.override as { play: Play } | null) ?? null,
    decidedBy: row.decidedBy,
    decidedByEmail: row.decidedByEmail,
    decidedAt:
      row.decidedAt instanceof Date ? row.decidedAt.toISOString() : String(row.decidedAt),
  };
}

/** Load the decision for a recommendation (joined to the decider's email), or null. */
async function loadByRecommendation(
  exec: Db | Tx,
  recommendationId: string,
): Promise<DecisionView | null> {
  const [row] = await exec
    .select({
      id: decisionRecords.id,
      recommendationId: decisionRecords.recommendationId,
      action: decisionRecords.action,
      note: decisionRecords.note,
      override: decisionRecords.override,
      decidedBy: decisionRecords.decidedBy,
      decidedByEmail: users.email,
      decidedAt: decisionRecords.decidedAt,
    })
    .from(decisionRecords)
    .innerJoin(users, eq(users.id, decisionRecords.decidedBy))
    .where(eq(decisionRecords.recommendationId, recommendationId))
    .limit(1);
  return row ? toView(row) : null;
}

/** Load the decision carrying an idempotency key (joined to the decider's email), or null. */
async function loadByIdempotencyKey(
  exec: Db | Tx,
  idempotencyKey: string,
): Promise<DecisionView | null> {
  const [row] = await exec
    .select({
      id: decisionRecords.id,
      recommendationId: decisionRecords.recommendationId,
      action: decisionRecords.action,
      note: decisionRecords.note,
      override: decisionRecords.override,
      decidedBy: decisionRecords.decidedBy,
      decidedByEmail: users.email,
      decidedAt: decisionRecords.decidedAt,
    })
    .from(decisionRecords)
    .innerJoin(users, eq(users.id, decisionRecords.decidedBy))
    .where(eq(decisionRecords.idempotencyKey, idempotencyKey))
    .limit(1);
  return row ? toView(row) : null;
}

/**
 * Record an immutable decision on a recommendation. See module header for the
 * invariants. Returns a discriminated result; the route maps codes to HTTP statuses.
 */
export async function recordDecision(input: RecordDecisionInput): Promise<DecisionResult> {
  // Malformed id can't match a uuid column — treat as absent rather than 500.
  if (!UUID_RE.test(input.recommendationId)) {
    return { ok: false, code: "NOT_FOUND" };
  }

  const db = getDb();
  const newStatus = STATUS_FOR_ACTION[input.action];

  try {
    return await db.transaction(async (tx) => {
      // Lock the recommendation row: concurrent deciders serialize here, so the
      // status check below is authoritative (decide-once) without racing.
      const [rec] = await tx
        .select({ id: recommendations.id, status: recommendations.status })
        .from(recommendations)
        .where(eq(recommendations.id, input.recommendationId))
        .for("update");

      if (!rec) return { ok: false, code: "NOT_FOUND" } as const;

      // Idempotent retry (F6-ERR3): a decision already exists for this key.
      const byKey = await loadByIdempotencyKey(tx, input.idempotencyKey);
      if (byKey) {
        if (
          byKey.recommendationId === input.recommendationId &&
          byKey.action === input.action
        ) {
          // Same operation replayed — return the existing decision, no new row.
          return { ok: true, created: false, decision: byKey, status: rec.status } as const;
        }
        if (byKey.recommendationId === input.recommendationId) {
          // Same key, different action — not a replay of the same request.
          return {
            ok: false,
            code: "ALREADY_DECIDED",
            decidedByEmail: byKey.decidedByEmail,
          } as const;
        }
        // Key reused for a different recommendation — a conflict, not a replay.
        return {
          ok: false,
          code: "ALREADY_DECIDED",
          decidedByEmail: byKey.decidedByEmail,
        } as const;
      }

      if (rec.status !== "PENDING") {
        if (DECIDED_STATUSES.has(rec.status)) {
          const existing = await loadByRecommendation(tx, input.recommendationId);
          return {
            ok: false,
            code: "ALREADY_DECIDED",
            decidedByEmail: existing?.decidedByEmail ?? "another user",
          } as const;
        }
        // EXPIRED or ERROR — not decidable, and never becomes decided.
        return { ok: false, code: "DECISION_NOT_ALLOWED", status: rec.status } as const;
      }

      const [inserted] = await tx
        .insert(decisionRecords)
        .values({
          recommendationId: input.recommendationId,
          action: input.action,
          note: input.note,
          override: input.override,
          decidedBy: input.userId,
          idempotencyKey: input.idempotencyKey,
        })
        .returning();

      await tx
        .update(recommendations)
        .set({ status: newStatus })
        .where(eq(recommendations.id, input.recommendationId));

      return {
        ok: true,
        created: true,
        decision: toView({ ...inserted, decidedByEmail: input.userEmail }),
        status: newStatus,
      } as const;
    });
  } catch (err) {
    // Backstop for a lost race (e.g. the same idempotency key committed concurrently
    // for a different recommendation, which the per-row lock doesn't serialize). The
    // aborted transaction can't be re-queried, so resolve on a fresh handle.
    if (!isUniqueViolation(err)) throw err;
    return resolveAfterConflict(db, input);
  }
}

async function resolveAfterConflict(
  db: Db,
  input: RecordDecisionInput,
): Promise<DecisionResult> {
  const byKey = await loadByIdempotencyKey(db, input.idempotencyKey);
  if (
    byKey &&
    byKey.recommendationId === input.recommendationId &&
    byKey.action === input.action
  ) {
    return { ok: true, created: false, decision: byKey, status: STATUS_FOR_ACTION[byKey.action] };
  }
  const byRec = await loadByRecommendation(db, input.recommendationId);
  if (byRec) {
    return { ok: false, code: "ALREADY_DECIDED", decidedByEmail: byRec.decidedByEmail };
  }
  if (byKey) {
    return { ok: false, code: "ALREADY_DECIDED", decidedByEmail: byKey.decidedByEmail };
  }
  // No decision found for either key — the violation was something else; surface it.
  throw new Error("DECISION_CONFLICT_UNRESOLVED");
}
