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
  uuid,
} from "drizzle-orm/pg-core";

import { materials, plants } from "./core";
import { runStatus } from "./enums";

const createdAt = timestamp("created_at", { withTimezone: true })
  .notNull()
  .defaultNow();

// E9 · Run — one recompute. warnings/counts are jsonb blobs.
export const runs = pgTable("runs", {
  id: uuid("id").primaryKey().defaultRandom(),
  status: runStatus("status").notNull().default("QUEUED"),
  startedAt: timestamp("started_at", { withTimezone: true }),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
  warnings: jsonb("warnings").notNull().default(sql`'[]'::jsonb`),
  counts: jsonb("counts").notNull().default(sql`'{}'::jsonb`),
  createdAt,
});

// E10 · DemandForecast — weekly qty forecast per material×plant. Carries run_id.
// `week` is the Monday of the ISO week (business date, no tz).
export const demandForecasts = pgTable("demand_forecasts", {
  id: uuid("id").primaryKey().defaultRandom(),
  runId: uuid("run_id")
    .notNull()
    .references(() => runs.id),
  materialId: uuid("material_id")
    .notNull()
    .references(() => materials.id),
  plantId: uuid("plant_id")
    .notNull()
    .references(() => plants.id),
  week: date("week").notNull(),
  p50QtyMt: numeric("p50_qty_mt", { precision: 12, scale: 3 }).notNull(),
  model: text("model").notNull(),
  backtestWape: numeric("backtest_wape").notNull(),
  createdAt,
});

// E11 · PriceForecast — P10/P50/P90 band per grade_family × horizon. Carries run_id.
// Invariant p10 <= p50 <= p90 enforced by check; money columns integer INR.
export const priceForecasts = pgTable(
  "price_forecasts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    runId: uuid("run_id")
      .notNull()
      .references(() => runs.id),
    gradeFamily: text("grade_family").notNull(),
    horizonWeeks: integer("horizon_weeks").notNull(),
    p10InrMt: bigint("p10_inr_mt", { mode: "number" }).notNull(),
    p50InrMt: bigint("p50_inr_mt", { mode: "number" }).notNull(),
    p90InrMt: bigint("p90_inr_mt", { mode: "number" }).notNull(),
    coverage8090: numeric("coverage_8090"),
    pinball: numeric("pinball"),
    createdAt,
  },
  (t) => [
    check(
      "price_forecasts_band_order",
      sql`${t.p10InrMt} <= ${t.p50InrMt} AND ${t.p50InrMt} <= ${t.p90InrMt}`,
    ),
    check("price_forecasts_p10_nonneg", sql`${t.p10InrMt} >= 0`),
  ],
);
