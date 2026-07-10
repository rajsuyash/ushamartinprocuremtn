import { fail, ok } from "@pdi/shared";
import type { NextRequest } from "next/server";

import { ackAlert } from "@/lib/alerts";
import { withApiAuth } from "@/lib/api-guard";

// POST /api/alerts/:id/ack (F7-AC2 happy path, F7-ERR1 409 ALREADY_ACKED).
// Role list is buyer/approver/admin — same set as CAPABILITIES.DECIDE, but
// acking an alert isn't a recommendation decision, so the array is inlined
// rather than borrowing that capability's name for an unrelated action.
//   200                    → alert acknowledged (or was already ACKED by this
//                            same request losing a benign race — status is
//                            authoritative either way)
//   NOT_FOUND (404)        → unknown/malformed alert id
//   ALREADY_ACKED (409)    → already acked by someone (F7-ERR1)
export const POST = withApiAuth<Promise<{ id: string }>>(
  async (req: NextRequest, { session, params }) => {
    const { id } = await params;

    const result = await ackAlert({
      alertId: id,
      userId: session.user.id,
      userEmail: session.user.email ?? "",
    });

    if (!result.ok) {
      if (result.code === "NOT_FOUND") {
        return Response.json(fail("NOT_FOUND", "Alert not found."), { status: 404 });
      }
      return Response.json(
        fail("ALREADY_ACKED", `Already acknowledged by ${result.ackedByEmail}.`),
        { status: 409 },
      );
    }

    return Response.json(ok({ alert: result.alert }), { status: 200 });
  },
  { roles: ["buyer", "approver", "admin"] },
);
