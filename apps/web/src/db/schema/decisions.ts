import { sql } from "drizzle-orm";
import {
  check,
  date,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

import { materials, plants, users } from "./core";
import {
  alertSeverity,
  alertStatus,
  alertType,
  decisionAction,
  memoMode,
  play,
  recommendationStatus,
} from "./enums";
import { runs } from "./analytics";

const createdAt = timestamp("created_at", { withTimezone: true })
  .notNull()
  .defaultNow();

// E13 · Recommendation — play per series per run. Carries run_id.
// order_lines / expected_impact / rationale are jsonb blobs (rendered from stored JSON, never recomputed).
// `play` is nullable: F5-ERR1/ERR3 degraded series persist as status='ERROR' with no
// play and order_lines '[]' — the CHECK below keeps that pairing the only legal one.
export const recommendations = pgTable(
  "recommendations",
  {
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
    play: play("play"),
    orderLines: jsonb("order_lines").notNull().default(sql`'[]'::jsonb`),
    expectedImpact: jsonb("expected_impact").notNull().default(sql`'{}'::jsonb`),
    rationale: jsonb("rationale").notNull().default(sql`'{}'::jsonb`),
    status: recommendationStatus("status").notNull().default("PENDING"),
    createdAt,
  },
  (t) => [
    check(
      "recommendations_play_null_iff_error",
      sql`(${t.play} IS NULL) = (${t.status} = 'ERROR')`,
    ),
  ],
);

// E14 · DecisionRecord — immutable human decision. Append-only in the app layer.
// UNIQUE(recommendation_id) = decide-once; UNIQUE(idempotency_key) = retry-safe.
export const decisionRecords = pgTable("decision_records", {
  id: uuid("id").primaryKey().defaultRandom(),
  recommendationId: uuid("recommendation_id")
    .notNull()
    .unique()
    .references(() => recommendations.id),
  action: decisionAction("action").notNull(),
  note: text("note").notNull().default(""),
  override: jsonb("override"),
  decidedBy: uuid("decided_by")
    .notNull()
    .references(() => users.id),
  decidedAt: timestamp("decided_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  idempotencyKey: text("idempotency_key").notNull().unique(),
});

// E15 · Alert — risk flag. Carries run_id; material/plant nullable (some alerts are portfolio-wide).
export const alerts = pgTable("alerts", {
  id: uuid("id").primaryKey().defaultRandom(),
  runId: uuid("run_id")
    .notNull()
    .references(() => runs.id),
  type: alertType("type").notNull(),
  severity: alertSeverity("severity").notNull(),
  materialId: uuid("material_id").references(() => materials.id),
  plantId: uuid("plant_id").references(() => plants.id),
  payload: jsonb("payload").notNull().default(sql`'{}'::jsonb`),
  status: alertStatus("status").notNull().default("OPEN"),
  ackedBy: uuid("acked_by").references(() => users.id),
  ackedAt: timestamp("acked_at", { withTimezone: true }),
  createdAt,
});

// E17 · Memo — stored weekly memo. period_start/end are business dates.
export const memos = pgTable("memos", {
  id: uuid("id").primaryKey().defaultRandom(),
  periodStart: date("period_start").notNull(),
  periodEnd: date("period_end").notNull(),
  mode: memoMode("mode").notNull(),
  modelId: text("model_id"),
  content: jsonb("content").notNull(),
  createdBy: uuid("created_by")
    .notNull()
    .references(() => users.id),
  createdAt,
});
