import { sql } from "drizzle-orm";
import {
  bigint,
  check,
  date,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";

import { materials, plants, suppliers, users } from "./core";
import { uploadStatus, uploadType } from "./enums";

const createdAt = timestamp("created_at", { withTimezone: true })
  .notNull()
  .defaultNow();

// Quantities are numeric(12,3) MT; money is integer INR (bigint), never float.
const qtyMt = (name: string) => numeric(name, { precision: 12, scale: 3 });

// E16 · UploadBatch — one file ingest. Every ingested row (E5/E6/E7/E8) traces back here.
export const uploadBatches = pgTable("upload_batches", {
  id: uuid("id").primaryKey().defaultRandom(),
  type: uploadType("type").notNull(),
  filename: text("filename").notNull(),
  status: uploadStatus("status").notNull().default("STAGED"),
  rows: integer("rows").notNull().default(0),
  validRows: integer("valid_rows").notNull().default(0),
  errors: jsonb("errors").notNull().default(sql`'[]'::jsonb`),
  // Staged VALID rows (post syntactic + reference validation), snake_case-keyed
  // ParsedRows. Persisting them on the batch row (vs a staging table) is the
  // simplest thing that survives a server restart: commit re-reads them, resolves
  // FK ids from codes, and inserts into the target table (T9). Empty once nothing
  // is left to stage.
  stagedRows: jsonb("staged_rows").notNull().default(sql`'[]'::jsonb`),
  uploadedBy: uuid("uploaded_by")
    .notNull()
    .references(() => users.id),
  createdAt,
});

// E5 · PurchaseOrder — committed PO line.
// UNIQUE(po_number, material_id, delivery_date) rejects duplicate PO lines.
export const purchaseOrders = pgTable(
  "purchase_orders",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    poNumber: text("po_number").notNull(),
    poDate: date("po_date").notNull(),
    supplierId: uuid("supplier_id")
      .notNull()
      .references(() => suppliers.id),
    materialId: uuid("material_id")
      .notNull()
      .references(() => materials.id),
    plantId: uuid("plant_id")
      .notNull()
      .references(() => plants.id),
    qtyMt: qtyMt("qty_mt").notNull(),
    unitPriceInr: bigint("unit_price_inr", { mode: "number" }).notNull(),
    deliveryDate: date("delivery_date").notNull(),
    uploadBatchId: uuid("upload_batch_id")
      .notNull()
      .references(() => uploadBatches.id),
    createdAt,
  },
  (t) => [
    unique("purchase_orders_line_uq").on(
      t.poNumber,
      t.materialId,
      t.deliveryDate,
    ),
    check("purchase_orders_qty_positive", sql`${t.qtyMt} > 0`),
    check("purchase_orders_price_nonneg", sql`${t.unitPriceInr} >= 0`),
  ],
);

// E6 · ConsumptionRecord — usage per day.
export const consumptionRecords = pgTable(
  "consumption_records",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    date: date("date").notNull(),
    materialId: uuid("material_id")
      .notNull()
      .references(() => materials.id),
    plantId: uuid("plant_id")
      .notNull()
      .references(() => plants.id),
    qtyMt: qtyMt("qty_mt").notNull(),
    uploadBatchId: uuid("upload_batch_id")
      .notNull()
      .references(() => uploadBatches.id),
    createdAt,
  },
  (t) => [check("consumption_records_qty_positive", sql`${t.qtyMt} > 0`)],
);

// E7 · InventorySnapshot — stock on a date. Zero stock is valid, negative is not.
export const inventorySnapshots = pgTable(
  "inventory_snapshots",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    asOfDate: date("as_of_date").notNull(),
    materialId: uuid("material_id")
      .notNull()
      .references(() => materials.id),
    plantId: uuid("plant_id")
      .notNull()
      .references(() => plants.id),
    qtyMt: qtyMt("qty_mt").notNull(),
    uploadBatchId: uuid("upload_batch_id")
      .notNull()
      .references(() => uploadBatches.id),
    createdAt,
  },
  (t) => [check("inventory_snapshots_qty_nonneg", sql`${t.qtyMt} >= 0`)],
);

// E8 · MarketPrice — index price point.
// UNIQUE(date, source, grade_family) rejects duplicate market-price rows.
export const marketPrices = pgTable(
  "market_prices",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    date: date("date").notNull(),
    source: text("source").notNull(),
    gradeFamily: text("grade_family").notNull(),
    priceInrMt: bigint("price_inr_mt", { mode: "number" }).notNull(),
    uploadBatchId: uuid("upload_batch_id")
      .notNull()
      .references(() => uploadBatches.id),
    createdAt,
  },
  (t) => [
    unique("market_prices_point_uq").on(t.date, t.source, t.gradeFamily),
    check("market_prices_price_nonneg", sql`${t.priceInrMt} >= 0`),
  ],
);
