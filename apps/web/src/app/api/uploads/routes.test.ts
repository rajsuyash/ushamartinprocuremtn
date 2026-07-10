import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import type { Session } from "next-auth";
import { NextRequest } from "next/server";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import type { Role } from "@/auth/access";
import { getSql } from "@/db/client";

import { GET as batchGET } from "./[id]/route";
import { POST as commitPOST } from "./[id]/commit/route";
import { POST as uploadPOST } from "./route";

// Integration tests for F2 (T9): upload → stage → commit lifecycle. Route handlers
// invoked directly (no Next server) with auth() mocked as a buyer, side effects
// asserted against the live compose postgres (DATABASE_URL, localhost:5442).

vi.mock("@/auth", () => ({ auth: vi.fn() }));

const { auth } = await import("@/auth");
const mockAuth = vi.mocked(auth as unknown as () => Promise<Session | null>);

const sql = getSql();
const TEST_USER_EMAIL = "t9-buyer@pdi.test";
const TEST_SOURCE = "TEST_IDX"; // market-price source, isolated from seeded "INDEX".
let testUserId = "";

const createdBatchIds: string[] = [];

const badConsumptionCsv = readFileSync(
  fileURLToPath(new URL("../../../../../../fixtures/bad_consumption.csv", import.meta.url)),
  "utf-8",
);

function sessionFor(role: Role): Session {
  return {
    user: { id: testUserId, email: `${role}@pdi.test`, role },
    expires: new Date(Date.now() + 3_600_000).toISOString(),
  } as Session;
}

function uploadReq(type: string, file: File): NextRequest {
  const form = new FormData();
  form.set("type", type);
  form.set("file", file);
  return new NextRequest("http://localhost:3000/api/uploads", {
    method: "POST",
    body: form,
  });
}

const csvFile = (content: string, name = "upload.csv"): File =>
  new File([content], name, { type: "text/csv" });

const commitReq = (id: string, body?: unknown) =>
  new NextRequest(`http://localhost:3000/api/uploads/${id}/commit`, {
    method: "POST",
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
const idCtx = (id: string) => ({ params: Promise.resolve({ id }) });

async function upload(type: string, file: File) {
  const res = await uploadPOST(uploadReq(type, file));
  const body = await res.json();
  if (body.success) createdBatchIds.push(body.data.batchId as string);
  return { res, body };
}

async function countByBatch(table: string, batchId: string): Promise<number> {
  const [row] = await sql`select count(*)::int as n from ${sql(table)} where upload_batch_id = ${batchId}`;
  return row.n as number;
}

beforeAll(async () => {
  // Reference data the fixtures depend on (idempotent — seed may already have it).
  await sql`insert into plants (code, name) values ('RNC','Ranchi'),('HSP','Hospet') on conflict (code) do nothing`;
  await sql`insert into materials (code, description, grade_family) values
    ('WR-5.5-HC','5.5mm HC','WR-STD'),('WR-8-MS','8mm MS','WR-STD'),('WR-12-LRPC','12mm LRPC','WR-LRPC')
    on conflict (code) do nothing`;
  await sql`insert into users (email, password_hash, role) values (${TEST_USER_EMAIL}, 'x', 'buyer')
    on conflict (email) do nothing`;
  const [u] = await sql`select id from users where email = ${TEST_USER_EMAIL}`;
  testUserId = u.id as string;
});

afterEach(async () => {
  vi.clearAllMocks();
  if (createdBatchIds.length > 0) {
    const ids = createdBatchIds.splice(0);
    for (const t of ["consumption_records", "market_prices", "purchase_orders", "inventory_snapshots"]) {
      await sql`delete from ${sql(t)} where upload_batch_id in ${sql(ids)}`;
    }
    await sql`delete from upload_batches where id in ${sql(ids)}`;
  }
  await sql`delete from market_prices where source = ${TEST_SOURCE}`;
});

afterAll(async () => {
  await sql`delete from users where email = ${TEST_USER_EMAIL}`;
  await sql.end();
});

describe("POST /api/uploads", () => {
  it("F2: viewer is denied MUTATE_DATA (403), no batch staged", async () => {
    const before = (await sql`select count(*)::int as n from upload_batches`)[0].n as number;
    mockAuth.mockResolvedValue(sessionFor("viewer"));
    const res = await uploadPOST(uploadReq("consumption", csvFile("date,material_code,plant_code,qty_mt\n")));
    expect(res.status).toBe(403);
    expect((await res.json()).error.code).toBe("FORBIDDEN_ROLE");
    expect((await sql`select count(*)::int as n from upload_batches`)[0].n).toBe(before);
  });

  it("F2-ERR1: missing required column → 400 MISSING_COLUMN, nothing staged", async () => {
    const before = (await sql`select count(*)::int as n from upload_batches`)[0].n as number;
    mockAuth.mockResolvedValue(sessionFor("buyer"));
    const res = await uploadPOST(
      uploadReq("consumption", csvFile("date,material_code,plant_code\n2026-06-01,WR-5.5-HC,RNC\n")),
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe("MISSING_COLUMN");
    expect(body.error.detail.column).toBe("qty_mt");
    expect((await sql`select count(*)::int as n from upload_batches`)[0].n).toBe(before);
  });

  it("F2-ERR3: file >20 MB → 413 FILE_TOO_LARGE, nothing staged", async () => {
    const before = (await sql`select count(*)::int as n from upload_batches`)[0].n as number;
    mockAuth.mockResolvedValue(sessionFor("buyer"));
    const big = csvFile("x".repeat(20 * 1024 * 1024 + 1), "big.csv");
    const res = await uploadPOST(uploadReq("consumption", big));
    expect(res.status).toBe(413);
    expect((await res.json()).error.code).toBe("FILE_TOO_LARGE");
    expect((await sql`select count(*)::int as n from upload_batches`)[0].n).toBe(before);
  });
});

describe("upload → commit happy path (F2-AC1 shape)", () => {
  it("stages a valid consumption CSV (201) then commits (200) into consumption_records", async () => {
    mockAuth.mockResolvedValue(sessionFor("buyer"));
    const content =
      "date,material_code,plant_code,qty_mt\n" +
      "2026-06-01,WR-5.5-HC,RNC,320.500\n" +
      "2026-06-08,WR-8-MS,HSP,240.000\n" +
      "2026-06-15,WR-12-LRPC,RNC,180.250\n";

    const { res, body } = await upload("consumption", csvFile(content));
    expect(res.status).toBe(201);
    expect(body.data).toMatchObject({ type: "consumption", rows: 3, validRows: 3, errors: [] });
    const batchId = body.data.batchId as string;

    const commitRes = await commitPOST(commitReq(batchId), idCtx(batchId));
    expect(commitRes.status).toBe(200);
    expect((await commitRes.json()).data).toEqual({ inserted: 3, skippedDuplicates: 0 });

    expect(await countByBatch("consumption_records", batchId)).toBe(3);
    const [row] = await sql`select qty_mt from consumption_records where upload_batch_id = ${batchId} and date = '2026-06-01'`;
    expect(row.qty_mt).toBe("320.500"); // numeric returned as string — never a float.

    const [batch] = await sql`select status from upload_batches where id = ${batchId}`;
    expect(batch.status).toBe("COMMITTED");
  });
});

describe("FIX-5 malformed rows (F2-ERR2)", () => {
  it("stages with 3 row errors, blocks plain commit, then commits valid-only (7 rows)", async () => {
    mockAuth.mockResolvedValue(sessionFor("buyer"));
    const { res, body } = await upload("consumption", csvFile(badConsumptionCsv, "bad_consumption.csv"));

    expect(res.status).toBe(201);
    expect(body.data.rows).toBe(10);
    expect(body.data.validRows).toBe(7);
    expect(body.data.errors).toEqual([
      { row: 3, code: "NEGATIVE_QTY", detail: "qty_mt" },
      { row: 4, code: "INVALID_DATE", detail: "date" },
      { row: 5, code: "UNKNOWN_PLANT", detail: "plant_code" },
    ]);
    const batchId = body.data.batchId as string;

    // Plain commit is blocked while errors remain.
    mockAuth.mockResolvedValue(sessionFor("buyer"));
    const blocked = await commitPOST(commitReq(batchId), idCtx(batchId));
    expect(blocked.status).toBe(409);
    expect((await blocked.json()).error.code).toBe("BLOCKING_ROW_ERRORS");
    expect(await countByBatch("consumption_records", batchId)).toBe(0);

    // valid-only commits exactly the 7 clean rows.
    mockAuth.mockResolvedValue(sessionFor("buyer"));
    const ok = await commitPOST(commitReq(batchId, { mode: "valid-only" }), idCtx(batchId));
    expect(ok.status).toBe(200);
    expect((await ok.json()).data).toEqual({ inserted: 7, skippedDuplicates: 0 });
    expect(await countByBatch("consumption_records", batchId)).toBe(7);
  });
});

describe("market_prices duplicates (F2-AC2)", () => {
  it("second overlapping file skips 3 duplicates, inserts only the new rows", async () => {
    mockAuth.mockResolvedValue(sessionFor("buyer"));
    const file1 =
      "date,source,grade_family,price_inr_mt\n" +
      `2026-06-01,${TEST_SOURCE},WR-STD,55000\n` +
      `2026-06-08,${TEST_SOURCE},WR-STD,55200\n` +
      `2026-06-15,${TEST_SOURCE},WR-STD,55400\n`;
    const first = await upload("market_prices", csvFile(file1));
    expect(first.res.status).toBe(201);
    const firstBatch = first.body.data.batchId as string;
    const firstCommit = await commitPOST(commitReq(firstBatch), idCtx(firstBatch));
    expect((await firstCommit.json()).data).toEqual({ inserted: 3, skippedDuplicates: 0 });

    const totalAfterFirst = (
      await sql`select count(*)::int as n from market_prices where source = ${TEST_SOURCE}`
    )[0].n as number;
    expect(totalAfterFirst).toBe(3);

    // 3 overlapping (same date/source/grade) + 2 new.
    mockAuth.mockResolvedValue(sessionFor("buyer"));
    const file2 =
      "date,source,grade_family,price_inr_mt\n" +
      `2026-06-01,${TEST_SOURCE},WR-STD,99999\n` +
      `2026-06-08,${TEST_SOURCE},WR-STD,99999\n` +
      `2026-06-15,${TEST_SOURCE},WR-STD,99999\n` +
      `2026-06-22,${TEST_SOURCE},WR-STD,55600\n` +
      `2026-06-29,${TEST_SOURCE},WR-STD,55800\n`;
    const second = await upload("market_prices", csvFile(file2));
    expect(second.body.data.validRows).toBe(5);
    const secondBatch = second.body.data.batchId as string;

    mockAuth.mockResolvedValue(sessionFor("buyer"));
    const secondCommit = await commitPOST(commitReq(secondBatch), idCtx(secondBatch));
    expect(secondCommit.status).toBe(200);
    expect((await secondCommit.json()).data).toEqual({ inserted: 2, skippedDuplicates: 3 });

    // +2 new only; no double rows.
    const total = (
      await sql`select count(*)::int as n from market_prices where source = ${TEST_SOURCE}`
    )[0].n as number;
    expect(total).toBe(5);
    // Original value untouched by the conflicting insert.
    const [kept] = await sql`select price_inr_mt from market_prices where source = ${TEST_SOURCE} and date = '2026-06-01'`;
    expect(Number(kept.price_inr_mt)).toBe(55000);
  });
});

describe("commit state gate", () => {
  it("recommitting a COMMITTED batch → 409 ALREADY_COMMITTED", async () => {
    mockAuth.mockResolvedValue(sessionFor("buyer"));
    const { body } = await upload(
      "consumption",
      csvFile("date,material_code,plant_code,qty_mt\n2026-06-01,WR-5.5-HC,RNC,10.000\n"),
    );
    const batchId = body.data.batchId as string;

    mockAuth.mockResolvedValue(sessionFor("buyer"));
    expect((await commitPOST(commitReq(batchId), idCtx(batchId))).status).toBe(200);

    mockAuth.mockResolvedValue(sessionFor("buyer"));
    const again = await commitPOST(commitReq(batchId), idCtx(batchId));
    expect(again.status).toBe(409);
    expect((await again.json()).error.code).toBe("ALREADY_COMMITTED");
    // No duplicate insert from the second attempt.
    expect(await countByBatch("consumption_records", batchId)).toBe(1);
  });
});

describe("GET /api/uploads/:id", () => {
  it("returns a staged batch, and 404s an unknown id", async () => {
    mockAuth.mockResolvedValue(sessionFor("buyer"));
    const { body } = await upload(
      "consumption",
      csvFile("date,material_code,plant_code,qty_mt\n2026-06-01,WR-5.5-HC,RNC,10.000\n"),
    );
    const batchId = body.data.batchId as string;

    mockAuth.mockResolvedValue(sessionFor("viewer"));
    const res = await batchGET(new NextRequest(`http://localhost:3000/api/uploads/${batchId}`), idCtx(batchId));
    expect(res.status).toBe(200);
    expect((await res.json()).data).toMatchObject({ batchId, type: "consumption", status: "STAGED" });

    mockAuth.mockResolvedValue(sessionFor("viewer"));
    const missing = await batchGET(
      new NextRequest("http://localhost:3000/api/uploads/00000000-0000-0000-0000-000000000000"),
      idCtx("00000000-0000-0000-0000-000000000000"),
    );
    expect(missing.status).toBe(404);
    expect((await missing.json()).error.code).toBe("NOT_FOUND");
  });
});
