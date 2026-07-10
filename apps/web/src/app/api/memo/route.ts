import { ok } from "@pdi/shared";

import { CAPABILITIES } from "@/auth/access";
import { getDb } from "@/db/client";
import { memos } from "@/db/schema";
import { withApiAuth } from "@/lib/api-guard";
import { buildWeekAggregate } from "@/lib/memo/aggregate";
import { generateMemo } from "@/lib/memo/generate";

// POST /api/memo — F9 weekly memo (PRD §6 F9 routes table). buyer/approver/admin only
// (viewer -> 403 FORBIDDEN_ROLE, same shape as every other mutating route in F1's
// matrix); role check happens in withApiAuth, never trusts the request body.
export const POST = withApiAuth(
  async (_req, { session }) => {
    const aggregate = await buildWeekAggregate();
    const { content, mode, modelId } = await generateMemo(aggregate);

    const db = getDb();
    const [row] = await db
      .insert(memos)
      .values({
        periodStart: aggregate.period.start,
        periodEnd: aggregate.period.end,
        mode,
        modelId,
        content,
        createdBy: session.user.id,
      })
      .returning();

    return Response.json(ok({ memo: row, mode }), { status: 200 });
  },
  { roles: CAPABILITIES.MUTATE_DATA },
);
