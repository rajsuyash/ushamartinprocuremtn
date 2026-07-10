import { DECISION_NOTE_MIN_LENGTH, decisionInputSchema, fail, ok } from "@pdi/shared";
import type { NextRequest } from "next/server";

import { CAPABILITIES } from "@/auth/access";
import { recordDecision, type DecisionResult } from "@/lib/decisions";
import { withApiAuth } from "@/lib/api-guard";

// POST /api/recommendations/:id/decision — record an immutable human decision (F6).
// DECIDE capability (buyer/approver/admin); viewer → 403 FORBIDDEN_ROLE (F1-ERR2).
// Identity comes from the session only, never the body.
//   200-shape success (201)          → decision recorded (or idempotent replay)
//   VALIDATION_ERROR (400)           → malformed body / bad enum
//   NOTE_REQUIRED (400)              → OVERRIDE/REJECT with <10-char note
//   OVERRIDE_PLAY_REQUIRED (400)     → OVERRIDE without override.play
//   NOT_FOUND (404)                  → unknown recommendation
//   ALREADY_DECIDED (409)            → already decided by another (F6-ERR1)
//   DECISION_NOT_ALLOWED (409)       → recommendation is EXPIRED / ERROR

const FAILURE_STATUS = {
  NOT_FOUND: 404,
  ALREADY_DECIDED: 409,
  DECISION_NOT_ALLOWED: 409,
} as const;

function failureResponse(result: Extract<DecisionResult, { ok: false }>): Response {
  if (result.code === "ALREADY_DECIDED") {
    return Response.json(
      fail("ALREADY_DECIDED", `Already decided by ${result.decidedByEmail}.`),
      { status: 409 },
    );
  }
  if (result.code === "DECISION_NOT_ALLOWED") {
    return Response.json(
      fail(
        "DECISION_NOT_ALLOWED",
        `This recommendation is ${result.status} and can no longer be decided.`,
      ),
      { status: 409 },
    );
  }
  return Response.json(fail("NOT_FOUND", "Recommendation not found."), {
    status: FAILURE_STATUS.NOT_FOUND,
  });
}

export const POST = withApiAuth<Promise<{ id: string }>>(
  async (req: NextRequest, { session, params }) => {
    const { id } = await params;

    const body = await req.json().catch(() => null);
    const parsed = decisionInputSchema.safeParse(body);
    if (!parsed.success) {
      return Response.json(fail("VALIDATION_ERROR", "Invalid decision payload."), {
        status: 400,
      });
    }

    const { action, note, override, idempotencyKey } = parsed.data;

    // Conditional rules kept out of the schema so each maps to its own named code.
    if (
      (action === "OVERRIDE" || action === "REJECT") &&
      note.trim().length < DECISION_NOTE_MIN_LENGTH
    ) {
      return Response.json(
        fail("NOTE_REQUIRED", "A note of at least 10 characters is required."),
        { status: 400 },
      );
    }
    if (action === "OVERRIDE" && !override?.play) {
      return Response.json(
        fail("OVERRIDE_PLAY_REQUIRED", "An override must name a replacement play."),
        { status: 400 },
      );
    }
    if (action !== "OVERRIDE" && override) {
      return Response.json(
        fail("VALIDATION_ERROR", "override is only valid with action OVERRIDE."),
        { status: 400 },
      );
    }

    const result = await recordDecision({
      recommendationId: id,
      userId: session.user.id,
      userEmail: session.user.email ?? "",
      action,
      note,
      override: action === "OVERRIDE" ? { play: override!.play } : null,
      idempotencyKey,
    });

    if (!result.ok) return failureResponse(result);

    return Response.json(ok({ decision: result.decision, status: result.status }), {
      status: 201,
    });
  },
  { roles: CAPABILITIES.DECIDE },
);
