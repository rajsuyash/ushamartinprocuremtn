import { and, gte, lt, sql } from "drizzle-orm";

import { getLatestDoneRun } from "@/app/forecasts/queries";
import { getDemandQuality, getPriceQuality } from "@/app/reports/pilot/queries";
import { getDb } from "@/db/client";
import { alerts, decisionRecords, recommendations, runs } from "@/db/schema";
import { alertSeverity, alertType, decisionAction, play } from "@/db/schema/enums";
import { computeValueReport } from "@/lib/value/value";

// T32 · F9 week-aggregate assembly (PRD §6 F9 input contract). AGGREGATES ONLY: counts,
// sums, and forecast-quality stats. Never user emails, decision notes, supplier
// contract terms, or env values — enforced by `scrubForbiddenFields` at the end of
// `buildWeekAggregate`, not just by construction (known-pitfalls: "aggregates only"
// is a boundary rule, not a convention to trust).

export interface Period {
  start: string; // business DATE, inclusive
  end: string; // business DATE, inclusive
}

export interface AlertCounts {
  byType: Record<string, number>;
  bySeverity: Record<string, number>;
}

export interface DemandQualityAggRow {
  materialCode: string;
  plantCode: string;
  model: string;
  backtestWape: number;
}

export interface PriceQualityAggRow {
  gradeFamily: string;
  coverage8090: number | null;
}

export interface ForecastQuality {
  wape: DemandQualityAggRow[];
  coverage: PriceQualityAggRow[];
}

export interface WeekAggregate {
  period: Period;
  runs: number;
  recommendationsByPlay: Record<string, number>;
  decisions: Record<string, number>;
  valueInr: number;
  alerts: AlertCounts;
  forecastQuality: ForecastQuality;
}

const PERIOD_DAYS = 7;

/** Trailing 7-day business-date window ending "today" (UTC business date — never
 * tz-shifted, PRD business-date convention). Pure + deterministic given `now`. */
export function computeWeekPeriod(now: Date = new Date()): Period {
  const end = now.toISOString().slice(0, 10);
  const start = new Date(`${end}T00:00:00Z`);
  start.setUTCDate(start.getUTCDate() - (PERIOD_DAYS - 1));
  return { start: start.toISOString().slice(0, 10), end };
}

/** [from, to) half-open timestamp range covering every instant of the period's
 * business dates, for filtering timestamptz columns (runs/decisions/alerts). */
function periodBounds(period: Period): { from: Date; to: Date } {
  const from = new Date(`${period.start}T00:00:00Z`);
  const to = new Date(`${period.end}T00:00:00Z`);
  to.setUTCDate(to.getUTCDate() + 1);
  return { from, to };
}

function zeroCounts(values: readonly string[]): Record<string, number> {
  return Object.fromEntries(values.map((v) => [v, 0]));
}

async function countRuns(from: Date, to: Date): Promise<number> {
  const db = getDb();
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(runs)
    .where(and(gte(runs.createdAt, from), lt(runs.createdAt, to)));
  return row?.n ?? 0;
}

async function recommendationsByPlayCounts(from: Date, to: Date): Promise<Record<string, number>> {
  const db = getDb();
  const rows = await db
    .select({ play: recommendations.play, n: sql<number>`count(*)::int` })
    .from(recommendations)
    .where(and(gte(recommendations.createdAt, from), lt(recommendations.createdAt, to)))
    .groupBy(recommendations.play);

  const counts = zeroCounts(play.enumValues);
  for (const r of rows) {
    if (r.play) counts[r.play] = r.n;
  }
  return counts;
}

async function decisionCounts(from: Date, to: Date): Promise<Record<string, number>> {
  const db = getDb();
  const rows = await db
    .select({ action: decisionRecords.action, n: sql<number>`count(*)::int` })
    .from(decisionRecords)
    .where(and(gte(decisionRecords.decidedAt, from), lt(decisionRecords.decidedAt, to)))
    .groupBy(decisionRecords.action);

  const counts = zeroCounts(decisionAction.enumValues);
  for (const r of rows) counts[r.action] = r.n;
  return counts;
}

async function alertCounts(from: Date, to: Date): Promise<AlertCounts> {
  const db = getDb();
  const rows = await db
    .select({ type: alerts.type, severity: alerts.severity, n: sql<number>`count(*)::int` })
    .from(alerts)
    .where(and(gte(alerts.createdAt, from), lt(alerts.createdAt, to)))
    .groupBy(alerts.type, alerts.severity);

  const byType = zeroCounts(alertType.enumValues);
  const bySeverity = zeroCounts(alertSeverity.enumValues);
  for (const r of rows) {
    byType[r.type] += r.n;
    bySeverity[r.severity] += r.n;
  }
  return { byType, bySeverity };
}

/** Reuses F8's computeValueReport (single source of truth for the baseline/value
 * math) and sums the decisions whose decidedAt falls inside this period. */
async function valueInPeriod(from: Date, to: Date): Promise<number> {
  const report = await computeValueReport();
  return report.decisions.reduce((sum, d) => {
    if (d.valueInr === null) return sum;
    const decidedAt = new Date(d.decidedAt).getTime();
    if (decidedAt < from.getTime() || decidedAt >= to.getTime()) return sum;
    return sum + d.valueInr;
  }, 0);
}

/** Reuses F3/F4's latest-run quality queries (same numbers already shown on
 * /reports/pilot) rather than recomputing WAPE/coverage here. */
async function forecastQuality(): Promise<ForecastQuality> {
  const latestRun = await getLatestDoneRun();
  if (!latestRun) return { wape: [], coverage: [] };

  const [wape, coverage] = await Promise.all([
    getDemandQuality(latestRun.id),
    getPriceQuality(latestRun.id),
  ]);
  return { wape, coverage };
}

// Key names that must never appear in a memo aggregate (PRD F9 forbidden fields:
// user emails, decision notes, supplier contract terms, env values). Substring match,
// case-insensitive — a smuggled `note`, `notes`, `contractTerms`, `apiKey`, etc. is
// caught regardless of exact casing.
const FORBIDDEN_KEY_SUBSTRINGS = [
  "email",
  "note",
  "contract",
  "secret",
  "token",
  "password",
  "apikey",
];

function isForbiddenKey(key: string): boolean {
  const k = key.toLowerCase();
  return FORBIDDEN_KEY_SUBSTRINGS.some((s) => k.includes(s));
}

/** True when `value` is the literal value of some currently-set env var — the
 * "env values" forbidden-field case, checked by content rather than by key name
 * since a leaked secret could be assigned to any field name. */
function isEnvValue(value: string): boolean {
  if (!value) return false;
  return Object.values(process.env).some((v) => !!v && v === value);
}

/**
 * Walks the assembled aggregate and throws if any key or string value looks like a
 * forbidden field (PRD F9: "MUST NOT include: user emails, decision notes, supplier
 * contract terms, any env/config values"). Throws rather than silently stripping —
 * a scrub that quietly drops data would hide the bug that put it there in the first
 * place (fail fast, known-pitfalls "no silent fallbacks").
 */
export function scrubForbiddenFields(value: unknown, path = "$"): void {
  if (value === null || value === undefined) return;

  if (typeof value === "string") {
    if (value.includes("@")) {
      throw new Error(`FORBIDDEN_FIELD: value at ${path} contains "@" (looks like an email)`);
    }
    if (isEnvValue(value)) {
      throw new Error(`FORBIDDEN_FIELD: value at ${path} matches a live environment variable value`);
    }
    return;
  }

  if (Array.isArray(value)) {
    value.forEach((v, i) => scrubForbiddenFields(v, `${path}[${i}]`));
    return;
  }

  if (typeof value === "object") {
    for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
      if (isForbiddenKey(key)) {
        throw new Error(`FORBIDDEN_FIELD: key "${key}" at ${path} is not allowed in a memo aggregate`);
      }
      scrubForbiddenFields(v, `${path}.${key}`);
    }
  }
}

/** Assembles the F9 week-aggregate input JSON (PRD §6 F9). Aggregates only — every
 * field is a count, sum, or forecast-quality stat sourced from committed data. */
export async function buildWeekAggregate(now: Date = new Date()): Promise<WeekAggregate> {
  const period = computeWeekPeriod(now);
  const { from, to } = periodBounds(period);

  const [runCount, recommendationsByPlay, decisions, alertsAgg, valueInr, quality] =
    await Promise.all([
      countRuns(from, to),
      recommendationsByPlayCounts(from, to),
      decisionCounts(from, to),
      alertCounts(from, to),
      valueInPeriod(from, to),
      forecastQuality(),
    ]);

  const aggregate: WeekAggregate = {
    period,
    runs: runCount,
    recommendationsByPlay,
    decisions,
    valueInr,
    alerts: alertsAgg,
    forecastQuality: quality,
  };

  scrubForbiddenFields(aggregate);
  return aggregate;
}
