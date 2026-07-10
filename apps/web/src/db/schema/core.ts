import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
  integer,
  numeric,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import { supplierType, userRole } from "./enums";

// Shared column builders. Business dates use `date` (string mode) so JS Date never
// tz-shifts them (known pitfall); timestamps are timestamptz.
const createdAt = timestamp("created_at", { withTimezone: true })
  .notNull()
  .defaultNow();

// E1 · User — login + role.
export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  role: userRole("role").notNull(),
  lastLoginAt: timestamp("last_login_at", { withTimezone: true }),
  createdAt,
});

// E2 · Plant — manufacturing site.
export const plants = pgTable("plants", {
  id: uuid("id").primaryKey().defaultRandom(),
  code: text("code").notNull().unique(),
  name: text("name").notNull(),
  createdAt,
});

// E3 · Material — purchasable grade. uom fixed to MT in v1.
export const materials = pgTable("materials", {
  id: uuid("id").primaryKey().defaultRandom(),
  code: text("code").notNull().unique(),
  description: text("description").notNull(),
  gradeFamily: text("grade_family").notNull(),
  uom: text("uom").notNull().default("MT"),
  createdAt,
});

// E4 · Supplier — source of material.
export const suppliers = pgTable("suppliers", {
  id: uuid("id").primaryKey().defaultRandom(),
  code: text("code").notNull().unique(),
  name: text("name").notNull(),
  type: supplierType("type").notNull(),
  leadTimeDays: integer("lead_time_days").notNull(),
  createdAt,
});

// E12 · PolicyConfig — versioned policy. Exactly one row may be active at a time
// (partial unique index). Money cap is integer INR, nullable.
export const policyConfigs = pgTable(
  "policy_configs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    minCoverDays: integer("min_cover_days").notNull(),
    targetCoverDays: integer("target_cover_days").notNull(),
    maxSupplierSharePct: numeric("max_supplier_share_pct", {
      precision: 5,
      scale: 2,
    }).notNull(),
    serviceLevelPct: numeric("service_level_pct", {
      precision: 5,
      scale: 2,
    }).notNull(),
    wcCapInr: bigint("wc_cap_inr", { mode: "number" }),
    isActive: boolean("is_active").notNull().default(true),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => users.id),
    createdAt,
  },
  (t) => [
    // Exactly one active policy: the value `true` can exist at most once.
    uniqueIndex("policy_configs_one_active_idx")
      .on(t.isActive)
      .where(sql`${t.isActive} = true`),
    check("policy_configs_wc_cap_nonneg", sql`${t.wcCapInr} >= 0`),
  ],
);
