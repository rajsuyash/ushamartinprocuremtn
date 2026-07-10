import { fail, ok } from "@pdi/shared";
import type { NextRequest } from "next/server";

import { CAPABILITIES } from "@/auth/access";
import { withApiAuth } from "@/lib/api-guard";
import { commitBatch } from "@/lib/staging";

// POST /api/uploads/:id/commit — commit the staged valid rows. MUTATE_DATA.
//   already COMMITTED         → 409 ALREADY_COMMITTED
//   row errors & not valid-only → 409 BLOCKING_ROW_ERRORS (F2-ERR2)
//   absent batch              → 404 NOT_FOUND
// The T10 `[data-action="commit-valid-only"]` button sends `{ mode: "valid-only" }`.
const COMMIT_FAILURES = {
  NOT_FOUND: { status: 404, message: "Upload batch not found." },
  ALREADY_COMMITTED: { status: 409, message: "This batch is already committed." },
  BLOCKING_ROW_ERRORS: {
    status: 409,
    message: "Batch has blocking row errors; commit valid rows only to proceed.",
  },
} as const;

export const POST = withApiAuth<Promise<{ id: string }>>(
  async (req: NextRequest, { params }) => {
    const { id } = await params;
    const body = (await req.json().catch(() => null)) as { mode?: unknown } | null;
    const mode = body?.mode === "valid-only" ? "valid-only" : undefined;

    const result = await commitBatch({ batchId: id, mode });
    if (result.ok) {
      return Response.json(
        ok({ inserted: result.inserted, skippedDuplicates: result.skippedDuplicates }),
      );
    }

    const { status, message } = COMMIT_FAILURES[result.code];
    return Response.json(fail(result.code, message), { status });
  },
  { roles: CAPABILITIES.MUTATE_DATA },
);
