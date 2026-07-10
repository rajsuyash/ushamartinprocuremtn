import { ok } from "@pdi/shared";

import { withApiAuth } from "@/lib/api-guard";
import { computeValueReport } from "@/lib/value/value";

// GET /api/reports/pilot — the F8 value report (PRD §6 F8 routes table). Same data
// the /reports/pilot page renders; any authenticated role may view (F1 matrix).
export const GET = withApiAuth(
  async () => {
    const report = await computeValueReport();
    return Response.json(ok(report));
  },
  { roles: "authenticated" },
);
