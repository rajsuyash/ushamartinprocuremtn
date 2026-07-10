import { FILE_CONTRACTS, fail, type FileType } from "@pdi/shared";

import { withApiAuth } from "@/lib/api-guard";

const TYPES: readonly FileType[] = [
  "purchase_orders",
  "consumption",
  "market_prices",
  "inventory",
];

function isFileType(value: string): value is FileType {
  return (TYPES as readonly string[]).includes(value);
}

// GET /api/templates/:type — one-line CSV of the exact PRD header columns for the
// given upload type (F2-AC4 documentation requirement). Any authenticated role may
// download a template. Deliberately just the header row: a second "note" row would
// be parsed as a malformed data row if the buyer fills the template in starting at
// row 2, so the DD-MM-YYYY ambiguity note is documented on the /data page next to
// the download links instead, not embedded in the file.
export const GET = withApiAuth<Promise<{ type: string }>>(
  async (_req, { params }) => {
    const { type } = await params;
    if (!isFileType(type)) {
      return Response.json(fail("VALIDATION_ERROR", "Unknown template type."), {
        status: 400,
      });
    }

    const csv = `${FILE_CONTRACTS[type].columns.join(",")}\n`;
    return new Response(csv, {
      status: 200,
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": `attachment; filename="${type}_template.csv"`,
      },
    });
  },
  { roles: "authenticated" },
);
