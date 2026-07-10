import { formatPriceInrMt } from "@/app/forecasts/format";

// ₹-with-space money formatting for /reports/pilot (T31, PRD §6 F8-AC1: "value ₹
// formatted (`₹ 12,34,567` Indian grouping)") — extends forecasts/format's
// `formatPriceInrMt` (en-IN grouping) with the ₹ prefix, a space, and a sign for
// negative deltas. Distinct from recommendations/format's `formatImpactInr`
// (no space) because the PRD literally spells the space out for this feature.
export function formatMoneyInr(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  const sign = value < 0 ? "-" : "";
  return `${sign}₹ ${formatPriceInrMt(Math.abs(value))}`;
}

// Adoption / WAPE / coverage are all "ratio -> percent string" — one helper,
// digits configurable since WAPE wants 1dp and coverage wants 0dp (forecasts
// page precedent).
export function formatPct(value: number | null | undefined, digits = 1): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  return `${value.toFixed(digits)}%`;
}
