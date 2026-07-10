import { ok } from "@pdi/shared";

import { withApiAuth } from "@/lib/api-guard";

// Any authenticated role may view recommendations (PRD F1 matrix: VIEW = all four).
// ponytail: empty-list stub — T22 replaces the body with the real query (filterable,
// paginated per known-pitfalls). The 401 guard path is the real F1-AC3 surface.
export const GET = withApiAuth(
  async () => Response.json(ok({ recommendations: [] })),
  { roles: "authenticated" },
);
