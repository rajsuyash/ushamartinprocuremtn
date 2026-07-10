import { Readable } from "node:stream";

import {
  parseUpload,
  type FileType,
  type ParsedRow,
  type RowError,
  type UploadFormat,
} from "@pdi/shared";
import { eq, inArray } from "drizzle-orm";

import { getDb } from "@/db/client";
import {
  consumptionRecords,
  inventorySnapshots,
  marketPrices,
  materials,
  plants,
  purchaseOrders,
  suppliers,
  uploadBatches,
} from "@/db/schema";

// F2 upload cap. Checked twice at the HTTP boundary (Content-Length header AND
// the actual decoded size) so neither a lying header nor a chunked body slips a
// >20 MB file past us (F2-ERR3).
export const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;

type Db = ReturnType<typeof getDb>;
// The transaction handle drizzle hands the `.transaction()` callback — derived
// from the db's own type so it stays exact without spelling out the generics.
type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

/** Which reference-code columns each file type must validate against seeded data,
 * and the per-row error code raised when a code is unknown. market_prices carries
 * no foreign codes, so it has none. */
type RefKind = "plant" | "material" | "supplier";
interface RefCheck {
  column: string;
  kind: RefKind;
  errorCode: "UNKNOWN_PLANT" | "UNKNOWN_MATERIAL" | "UNKNOWN_SUPPLIER";
}

const REFERENCE_CHECKS: Record<FileType, readonly RefCheck[]> = {
  purchase_orders: [
    { column: "plant_code", kind: "plant", errorCode: "UNKNOWN_PLANT" },
    { column: "material_code", kind: "material", errorCode: "UNKNOWN_MATERIAL" },
    { column: "supplier_code", kind: "supplier", errorCode: "UNKNOWN_SUPPLIER" },
  ],
  consumption: [
    { column: "material_code", kind: "material", errorCode: "UNKNOWN_MATERIAL" },
    { column: "plant_code", kind: "plant", errorCode: "UNKNOWN_PLANT" },
  ],
  market_prices: [],
  inventory: [
    { column: "material_code", kind: "material", errorCode: "UNKNOWN_MATERIAL" },
    { column: "plant_code", kind: "plant", errorCode: "UNKNOWN_PLANT" },
  ],
};

const REF_TABLE = { plant: plants, material: materials, supplier: suppliers } as const;

export interface StageResult {
  batchId: string;
  type: FileType;
  rows: number;
  validRows: number;
  errors: RowError[];
}

/** One reference-table lookup for a whole code set — never per row (no N+1). */
async function knownCodes(db: Db, kind: RefKind, codes: string[]): Promise<Set<string>> {
  if (codes.length === 0) return new Set();
  const table = REF_TABLE[kind];
  const found = await db
    .select({ code: table.code })
    .from(table)
    .where(inArray(table.code, codes));
  return new Set(found.map((r) => r.code));
}

/**
 * Parse → syntactic-validate (shared ingest lib) → reference-validate against
 * seeded plants/materials/suppliers → persist a STAGED batch with per-row errors
 * and the surviving valid rows. Throws `MissingColumnError` (F2-ERR1) before any
 * batch is created; every other outcome stages a batch and returns 201-shaped data.
 */
export async function stageUpload(input: {
  fileType: FileType;
  filename: string;
  format: UploadFormat;
  source: Readable | Buffer;
  uploadedBy: string;
}): Promise<StageResult> {
  const { fileType, filename, format, source, uploadedBy } = input;
  const db = getDb();

  // Throws MissingColumnError (F2-ERR1) → caller maps to 400, nothing staged.
  const parsed = await parseUpload(fileType, format, source);

  // Recover each valid row's original file row number: valid rows are exactly the
  // data rows [1..totalRows] that raised no syntactic error, in file order — so
  // zipping the ascending gap list with `parsed.rows` restores their numbers.
  const syntacticBadRows = new Set(parsed.errors.map((e) => e.row));
  const validRowNumbers: number[] = [];
  for (let n = 1; n <= parsed.meta.totalRows; n++) {
    if (!syntacticBadRows.has(n)) validRowNumbers.push(n);
  }

  const checks = REFERENCE_CHECKS[fileType];
  const known: Partial<Record<RefKind, Set<string>>> = {};
  for (const kind of new Set(checks.map((c) => c.kind))) {
    const codes = new Set<string>();
    for (const check of checks.filter((c) => c.kind === kind)) {
      for (const row of parsed.rows) codes.add(String(row[check.column]));
    }
    known[kind] = await knownCodes(db, kind, [...codes]);
  }

  const stagedRows: ParsedRow[] = [];
  const refErrors: RowError[] = [];
  parsed.rows.forEach((row, i) => {
    const rowNumber = validRowNumbers[i];
    let bad = false;
    for (const check of checks) {
      const code = String(row[check.column]);
      if (!known[check.kind]!.has(code)) {
        refErrors.push({ row: rowNumber, code: check.errorCode, detail: check.column });
        bad = true;
      }
    }
    if (!bad) stagedRows.push(row);
  });

  // Stable sort by row keeps syntactic errors (already in array order) ahead of
  // reference errors for the same row, and orders the list ascending for the UI.
  const errors = [...parsed.errors, ...refErrors].sort((a, b) => a.row - b.row);

  const [batch] = await db
    .insert(uploadBatches)
    .values({
      type: fileType,
      filename,
      status: "STAGED",
      rows: parsed.meta.totalRows,
      validRows: stagedRows.length,
      errors,
      stagedRows,
      uploadedBy,
    })
    .returning({ id: uploadBatches.id });

  return {
    batchId: batch.id,
    type: fileType,
    rows: parsed.meta.totalRows,
    validRows: stagedRows.length,
    errors,
  };
}

export interface BatchView {
  batchId: string;
  type: FileType;
  status: "STAGED" | "COMMITTED" | "FAILED";
  rows: number;
  validRows: number;
  errors: RowError[];
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** GET /api/uploads/:id backing read. `null` → 404. A malformed (non-UUID) id is
 * treated as "not found" rather than letting Postgres raise a cast error. */
export async function getBatch(batchId: string): Promise<BatchView | null> {
  if (!UUID_RE.test(batchId)) return null;
  const db = getDb();
  // Explicit column list: never drag the staged_rows jsonb blob (≤ ~15MB on a
  // 20MB upload) across the wire on every status poll.
  const [b] = await db
    .select({
      id: uploadBatches.id,
      type: uploadBatches.type,
      status: uploadBatches.status,
      rows: uploadBatches.rows,
      validRows: uploadBatches.validRows,
      errors: uploadBatches.errors,
    })
    .from(uploadBatches)
    .where(eq(uploadBatches.id, batchId));
  if (!b) return null;
  return {
    batchId: b.id,
    type: b.type,
    status: b.status,
    rows: b.rows,
    validRows: b.validRows,
    errors: b.errors as RowError[],
  };
}

export type CommitResult =
  | { ok: true; inserted: number; skippedDuplicates: number }
  | { ok: false; code: "NOT_FOUND" | "ALREADY_COMMITTED" | "BLOCKING_ROW_ERRORS" };

/** Map a reference table's code→id once (tables are tiny — 2-3 rows). */
async function codeToId(tx: Tx, kind: RefKind): Promise<Map<string, string>> {
  const table = REF_TABLE[kind];
  const rows = await tx.select({ id: table.id, code: table.code }).from(table);
  return new Map(rows.map((r) => [r.code, r.id]));
}

/** Insert the staged valid rows into the target table, resolving FK ids from codes
 * and applying the F2-AC2 duplicate keys. Returns actual inserts vs skipped dupes.
 * All callers run inside the commit transaction. */
async function insertStaged(
  tx: Tx,
  type: FileType,
  staged: ParsedRow[],
  batchId: string,
): Promise<{ inserted: number; skippedDuplicates: number }> {
  if (staged.length === 0) return { inserted: 0, skippedDuplicates: 0 };

  if (type === "market_prices") {
    const values = staged.map((r) => ({
      date: String(r.date),
      source: String(r.source),
      gradeFamily: String(r.grade_family),
      priceInrMt: Number(r.price_inr_mt),
      uploadBatchId: batchId,
    }));
    const ins = await tx
      .insert(marketPrices)
      .values(values)
      // F2-AC2: idempotent on (date, source, grade_family).
      .onConflictDoNothing({
        target: [marketPrices.date, marketPrices.source, marketPrices.gradeFamily],
      })
      .returning({ id: marketPrices.id });
    return { inserted: ins.length, skippedDuplicates: values.length - ins.length };
  }

  const material = await codeToId(tx, "material");
  const plant = await codeToId(tx, "plant");

  if (type === "consumption") {
    const values = staged.map((r) => ({
      date: String(r.date),
      // ponytail: codes were reference-validated at stage time, so the `!` holds
      // unless reference data was deleted between stage and commit — a FK error
      // then rolls the whole commit back, which is the safe outcome.
      materialId: material.get(String(r.material_code))!,
      plantId: plant.get(String(r.plant_code))!,
      qtyMt: String(r.qty_mt), // numeric(12,3) — pass as string, never float.
      uploadBatchId: batchId,
    }));
    const ins = await tx
      .insert(consumptionRecords)
      .values(values)
      .returning({ id: consumptionRecords.id });
    return { inserted: ins.length, skippedDuplicates: 0 };
  }

  if (type === "inventory") {
    const values = staged.map((r) => ({
      asOfDate: String(r.as_of_date),
      materialId: material.get(String(r.material_code))!,
      plantId: plant.get(String(r.plant_code))!,
      qtyMt: String(r.qty_mt),
      uploadBatchId: batchId,
    }));
    const ins = await tx
      .insert(inventorySnapshots)
      .values(values)
      .returning({ id: inventorySnapshots.id });
    return { inserted: ins.length, skippedDuplicates: 0 };
  }

  // purchase_orders
  const supplier = await codeToId(tx, "supplier");
  const values = staged.map((r) => ({
    poNumber: String(r.po_number),
    poDate: String(r.po_date),
    supplierId: supplier.get(String(r.supplier_code))!,
    materialId: material.get(String(r.material_code))!,
    plantId: plant.get(String(r.plant_code))!,
    qtyMt: String(r.qty_mt),
    unitPriceInr: Number(r.unit_price_inr),
    deliveryDate: String(r.delivery_date),
    uploadBatchId: batchId,
  }));
  const ins = await tx
    .insert(purchaseOrders)
    .values(values)
    // F2-AC2 / known pitfall: PO dup key is (po_number, material_id, delivery_date).
    .onConflictDoNothing({
      target: [purchaseOrders.poNumber, purchaseOrders.materialId, purchaseOrders.deliveryDate],
    })
    .returning({ id: purchaseOrders.id });
  return { inserted: ins.length, skippedDuplicates: values.length - ins.length };
}

/**
 * Commit a staged batch. State gate first: absent → NOT_FOUND; already COMMITTED →
 * ALREADY_COMMITTED (idempotent recommit); has row errors and caller didn't opt into
 * `valid-only` → BLOCKING_ROW_ERRORS (F2-ERR2). Otherwise, in ONE transaction:
 * `SELECT … FOR UPDATE` re-checks the status to close the concurrent-commit race,
 * inserts the staged rows (dupes skipped by the unique keys), and flips the batch to
 * COMMITTED. Recommit-safety = the status gate + the unique constraints together.
 */
export async function commitBatch(input: {
  batchId: string;
  mode?: "valid-only";
}): Promise<CommitResult> {
  const { batchId, mode } = input;
  if (!UUID_RE.test(batchId)) return { ok: false, code: "NOT_FOUND" };

  const db = getDb();
  const [batch] = await db
    .select()
    .from(uploadBatches)
    .where(eq(uploadBatches.id, batchId));

  if (!batch) return { ok: false, code: "NOT_FOUND" };
  if (batch.status === "COMMITTED") return { ok: false, code: "ALREADY_COMMITTED" };

  const errors = batch.errors as RowError[];
  if (errors.length > 0 && mode !== "valid-only") {
    return { ok: false, code: "BLOCKING_ROW_ERRORS" };
  }

  const staged = batch.stagedRows as ParsedRow[];

  return db.transaction(async (tx) => {
    const [locked] = await tx
      .select({ status: uploadBatches.status })
      .from(uploadBatches)
      .where(eq(uploadBatches.id, batchId))
      .for("update");
    // Batch deleted between the outer read and the lock — clean 404, not a 500.
    if (!locked) {
      return { ok: false, code: "NOT_FOUND" } as const;
    }
    // Another commit won the lock first — bail without double-inserting.
    if (locked.status === "COMMITTED") {
      return { ok: false, code: "ALREADY_COMMITTED" } as const;
    }

    const counts = await insertStaged(tx, batch.type, staged, batchId);
    await tx
      .update(uploadBatches)
      .set({ status: "COMMITTED" })
      .where(eq(uploadBatches.id, batchId));

    return { ok: true, ...counts } as const;
  });
}
