import { pgEnum } from "drizzle-orm/pg-core";

// PRD §7 status/role/play/severity enums as first-class pg enums.
// Values are contractual — they appear verbatim in API payloads and AC assertions.

export const userRole = pgEnum("user_role", [
  "viewer",
  "buyer",
  "approver",
  "admin",
]);

export const supplierType = pgEnum("supplier_type", ["DOMESTIC", "IMPORT"]);

export const runStatus = pgEnum("run_status", [
  "QUEUED",
  "RUNNING",
  "DONE",
  "FAILED",
]);

// The five plays (PRD F5). HEDGE_LOCK is memo-only — order lines must be empty for it.
export const play = pgEnum("play", [
  "BUY_NOW",
  "WAIT",
  "PARTIAL_BUY",
  "HEDGE_LOCK",
  "SPLIT_SUPPLIERS",
]);

// ERROR = F5-ERR1/ERR3 degraded outcome (NO_FEASIBLE_PLAN / SOLVER_TIMEOUT /
// MODEL_INVALID) — a recommendation-level error row with no play (T22).
export const recommendationStatus = pgEnum("recommendation_status", [
  "PENDING",
  "APPROVED",
  "OVERRIDDEN",
  "REJECTED",
  "EXPIRED",
  "ERROR",
]);

export const decisionAction = pgEnum("decision_action", [
  "APPROVE",
  "OVERRIDE",
  "REJECT",
]);

export const alertType = pgEnum("alert_type", [
  "COVER_BREACH",
  "CONC_BREACH",
  "BAND_WIDENING",
  "PRICE_SPIKE",
]);

export const alertSeverity = pgEnum("alert_severity", [
  "INFO",
  "WARN",
  "CRITICAL",
]);

export const alertStatus = pgEnum("alert_status", ["OPEN", "ACKED"]);

// Four ingest file types (PRD F2 headers table).
export const uploadType = pgEnum("upload_type", [
  "purchase_orders",
  "consumption",
  "market_prices",
  "inventory",
]);

export const uploadStatus = pgEnum("upload_status", [
  "STAGED",
  "COMMITTED",
  "FAILED",
]);

export const memoMode = pgEnum("memo_mode", ["LLM", "TEMPLATE"]);
