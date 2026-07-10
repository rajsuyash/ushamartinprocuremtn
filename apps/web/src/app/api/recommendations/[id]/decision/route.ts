import { fail } from "@pdi/shared";

import { CAPABILITIES } from "@/auth/access";
import { withApiAuth } from "@/lib/api-guard";

// Deciding a recommendation needs the DECIDE capability (buyer/approver/admin —
// PRD F1 matrix). Viewers get 403 FORBIDDEN_ROLE with no DecisionRecord side effect
// (F1-ERR2).
// ponytail: 501 stub — T25 implements the decision write (idempotency_key,
// decide-once). Only the 401/403 guard paths are contractual here.
export const POST = withApiAuth<Promise<{ id: string }>>(
  async () =>
    Response.json(fail("NOT_IMPLEMENTED", "Decision handling lands in T25."), {
      status: 501,
    }),
  { roles: CAPABILITIES.DECIDE },
);
