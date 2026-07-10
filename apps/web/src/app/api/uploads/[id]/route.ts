import { fail, ok } from "@pdi/shared";

import { withApiAuth } from "@/lib/api-guard";
import { getBatch } from "@/lib/staging";

// GET /api/uploads/:id — batch status + row errors. Any authenticated role (VIEW).
export const GET = withApiAuth<Promise<{ id: string }>>(
  async (_req, { params }) => {
    const { id } = await params;
    const batch = await getBatch(id);
    if (!batch) {
      return Response.json(fail("NOT_FOUND", "Upload batch not found."), {
        status: 404,
      });
    }
    return Response.json(ok(batch));
  },
  { roles: "authenticated" },
);
