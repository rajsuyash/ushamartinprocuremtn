import { Readable } from "node:stream";

import { fail, MissingColumnError, ok, type FileType } from "@pdi/shared";
import type { NextRequest } from "next/server";

import { CAPABILITIES } from "@/auth/access";
import { withApiAuth } from "@/lib/api-guard";
import { MAX_UPLOAD_BYTES, stageUpload } from "@/lib/staging";

const UPLOAD_TYPES: readonly FileType[] = [
  "purchase_orders",
  "consumption",
  "market_prices",
  "inventory",
];

function isFileType(value: unknown): value is FileType {
  return typeof value === "string" && (UPLOAD_TYPES as readonly string[]).includes(value);
}

function isXlsx(file: File): boolean {
  return (
    /\.xlsx$/i.test(file.name) ||
    file.type.includes("spreadsheetml") ||
    file.type === "application/vnd.ms-excel"
  );
}

// POST /api/uploads (multipart) — parse + validate a file into a STAGED batch.
// MUTATE_DATA (buyer/approver/admin). Oversize is rejected on the declared
// Content-Length AND the decoded file size, so a small/absent header can't smuggle
// a >20 MB body past the cap (F2-ERR3).
export const POST = withApiAuth(
  async (req: NextRequest, { session }) => {
    const declared = Number(req.headers.get("content-length") ?? 0);
    if (Number.isFinite(declared) && declared > MAX_UPLOAD_BYTES) {
      return Response.json(fail("FILE_TOO_LARGE", "File exceeds the 20 MB limit."), {
        status: 413,
      });
    }

    const form = await req.formData();
    const type = form.get("type");
    const file = form.get("file");

    if (!isFileType(type)) {
      return Response.json(
        fail("VALIDATION_ERROR", "Field `type` must be one of the four upload types."),
        { status: 400 },
      );
    }
    if (!(file instanceof File)) {
      return Response.json(fail("VALIDATION_ERROR", "Field `file` is required."), {
        status: 400,
      });
    }
    if (file.size > MAX_UPLOAD_BYTES) {
      return Response.json(fail("FILE_TOO_LARGE", "File exceeds the 20 MB limit."), {
        status: 413,
      });
    }

    const format = isXlsx(file) ? "xlsx" : "csv";
    // `File.stream()` is typed as the DOM ReadableStream; `Readable.fromWeb` wants
    // node's web ReadableStream. They're the same runtime object — bridge the one
    // boundary call via the method's own parameter type (same pattern parse-xlsx uses).
    const source =
      format === "xlsx"
        ? Buffer.from(await file.arrayBuffer())
        : Readable.fromWeb(file.stream() as unknown as Parameters<typeof Readable.fromWeb>[0]);

    try {
      const result = await stageUpload({
        fileType: type,
        filename: file.name,
        format,
        source,
        uploadedBy: session.user.id,
      });
      return Response.json(ok(result), { status: 201 });
    } catch (err) {
      if (err instanceof MissingColumnError) {
        // F2-ERR1: nothing staged; the offending column travels in `detail`.
        return Response.json(
          fail("MISSING_COLUMN", err.message, { column: err.column }),
          { status: 400 },
        );
      }
      throw err;
    }
  },
  { roles: CAPABILITIES.MUTATE_DATA },
);
