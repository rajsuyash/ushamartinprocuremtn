import { formatMoneyInr } from "@/app/reports/pilot/format";

import type { WeekAggregate } from "./aggregate";

// T32 · F9 deterministic template memo (PRD §6 F9 output contract + fallback path).
// Pure function of the week aggregate — same input always renders the same memo, no
// clock/random reads, so it's a safe fallback when the LLM path (T33) times out or
// returns schema-invalid output, and a safe default while ANTHROPIC_API_KEY is unset.

export interface MemoKeyNumber {
  label: string;
  value: string;
}

export interface MemoContent {
  headline: string;
  summaryMd: string;
  keyNumbers: MemoKeyNumber[];
  risks: string[];
}

const HEADLINE_MAX_CHARS = 120;
const SUMMARY_MAX_CHARS = 2500;
const KEY_NUMBERS_MAX = 6;
const RISKS_MAX = 4;

// PRD §12 pilot targets, reused here so the template's risk lines flag the same
// thresholds the launch-criteria table cares about.
const WAPE_TARGET = 0.25;
const COVERAGE_TARGET_MIN = 0.7;
const COVERAGE_TARGET_MAX = 0.9;

function sum(values: number[]): number {
  return values.reduce((total, v) => total + v, 0);
}

function avg(values: number[]): number | null {
  return values.length ? sum(values) / values.length : null;
}

function formatPct1(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function countsLine(counts: Record<string, number>): string {
  return Object.entries(counts)
    .map(([k, n]) => `${k} ${n}`)
    .join(", ");
}

export function buildTemplateMemo(aggregate: WeekAggregate): MemoContent {
  const totalRecs = sum(Object.values(aggregate.recommendationsByPlay));
  const totalDecisions = sum(Object.values(aggregate.decisions));
  const totalAlerts = sum(Object.values(aggregate.alerts.byType));
  const avgWape = avg(aggregate.forecastQuality.wape.map((r) => r.backtestWape));
  const valueStr = formatMoneyInr(aggregate.valueInr);

  const headline = truncate(
    `${aggregate.period.start} to ${aggregate.period.end}: ${aggregate.runs} run(s), ` +
      `${totalRecs} recommendation(s), ${totalDecisions} decision(s), ${valueStr} value`,
    HEADLINE_MAX_CHARS,
  );

  const summaryMd = truncate(
    [
      `# Weekly PDI summary — ${aggregate.period.start} to ${aggregate.period.end}`,
      "",
      `- Runs completed: ${aggregate.runs}`,
      `- Recommendations by play: ${countsLine(aggregate.recommendationsByPlay)}`,
      `- Decisions: ${countsLine(aggregate.decisions)}`,
      `- Measured value: ${valueStr}`,
      `- Alerts: ${countsLine(aggregate.alerts.byType)}`,
      `- Avg demand WAPE (latest run): ${avgWape !== null ? formatPct1(avgWape) : "n/a"}`,
    ].join("\n"),
    SUMMARY_MAX_CHARS,
  );

  const keyNumbers: MemoKeyNumber[] = [
    { label: "Runs", value: String(aggregate.runs) },
    { label: "Recommendations", value: String(totalRecs) },
    { label: "Decisions", value: String(totalDecisions) },
    { label: "Value", value: valueStr },
    { label: "Alerts", value: String(totalAlerts) },
    { label: "Avg demand WAPE", value: avgWape !== null ? formatPct1(avgWape) : "n/a" },
  ].slice(0, KEY_NUMBERS_MAX);

  const risks: string[] = [];
  if (aggregate.alerts.bySeverity.CRITICAL > 0) {
    risks.push(`${aggregate.alerts.bySeverity.CRITICAL} critical alert(s) open this week.`);
  }
  if (aggregate.decisions.REJECT > 0) {
    risks.push(`${aggregate.decisions.REJECT} recommendation(s) rejected this week.`);
  }
  const offCoverage = aggregate.forecastQuality.coverage.filter(
    (c) =>
      c.coverage8090 !== null &&
      (c.coverage8090 < COVERAGE_TARGET_MIN || c.coverage8090 > COVERAGE_TARGET_MAX),
  );
  if (offCoverage.length > 0) {
    risks.push(
      `${offCoverage.length} grade famil${offCoverage.length === 1 ? "y" : "ies"} outside the ` +
        `${COVERAGE_TARGET_MIN * 100}-${COVERAGE_TARGET_MAX * 100}% price-band coverage target.`,
    );
  }
  const offWape = aggregate.forecastQuality.wape.filter((r) => r.backtestWape > WAPE_TARGET);
  if (offWape.length > 0) {
    risks.push(`${offWape.length} demand series above the ${WAPE_TARGET * 100}% WAPE target.`);
  }

  return { headline, summaryMd, keyNumbers, risks: risks.slice(0, RISKS_MAX) };
}
