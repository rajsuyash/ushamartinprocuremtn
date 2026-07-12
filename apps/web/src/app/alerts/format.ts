// Pure alert-payload -> UI formatting (no db, no React — unit-testable in
// isolation, mirrors app/recommendations/chips.ts). Payload shapes are the
// four PRD F7 trigger types, written by services/engine's alerts stage
// (T28, stages.py _cover_breach_alert / _conc_breach_alerts /
// _band_widening_alerts / _price_spike_alerts).

type AlertPayload = Record<string, unknown>;

const SEVERITY_CHIP_CLASS: Record<string, string> = {
  CRITICAL: "bg-risk-surface text-risk",
  WARN: "bg-warn-surface text-warn",
  INFO: "bg-surface-alt text-muted",
};

/** Tailwind classes for the severity chip. Falls back to a neutral chip for
 * any unrecognized value rather than throwing (defensive against enum drift). */
export function severityChipClass(severity: string): string {
  return SEVERITY_CHIP_CLASS[severity] ?? "bg-surface-alt text-muted";
}

function signed(n: unknown): string {
  const num = Number(n);
  return `${num > 0 ? "+" : ""}${num}`;
}

/** One-line human summary of an alert's payload, keyed off its type. Falls
 * back to a generic message for any unrecognized type so the row never blanks. */
export function summarizeAlertPayload(type: string, payload: AlertPayload): string {
  switch (type) {
    case "COVER_BREACH":
      return `${payload.coverDays}d vs ${payload.minCoverDays}d floor`;
    case "CONC_BREACH":
      return `${payload.supplierCode} ${payload.sharePct}% > ${payload.capPct}%`;
    case "BAND_WIDENING":
      return `${payload.gradeFamily} band ${payload.spreadPct}% at ${payload.horizonWeeks}w`;
    case "PRICE_SPIKE":
      return `${payload.gradeFamily} ${signed(payload.wowMovePct)}% w/w`;
    default:
      return "See detail";
  }
}
