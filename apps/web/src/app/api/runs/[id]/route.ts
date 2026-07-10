import { fail, ok } from "@pdi/shared";
import { eq } from "drizzle-orm";

import { getDb } from "@/db/client";
import { runs } from "@/db/schema/analytics";
import { withApiAuth } from "@/lib/api-guard";

// Any authenticated role may poll run status (PRD F1 matrix: VIEW = all four).
export const GET = withApiAuth<Promise<{ id: string }>>(
  async (_req, { params }) => {
    const { id } = await params;
    const db = getDb();

    const [run] = await db.select().from(runs).where(eq(runs.id, id)).limit(1);

    if (!run) {
      return Response.json(fail("NOT_FOUND", "Run not found."), { status: 404 });
    }

    return Response.json(ok({ run }), { status: 200 });
  },
  { roles: "authenticated" },
);
