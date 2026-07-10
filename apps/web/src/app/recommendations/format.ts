import { formatPriceInrMt } from "@/app/forecasts/format";

// Signed ₹ formatting for expected-impact deltas (detail page P10/P50/P90 cost
// deltas, working-capital delta). A delta's sign is the whole point (negative =
// cost saving) so it's shown explicitly, unlike the plain price-per-MT figures
// which reuse forecasts/format's unsigned `formatPriceInrMt` (en-IN grouping,
// conventions.md "Money display").
export function formatImpactInr(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  const sign = value < 0 ? "-" : "";
  return `${sign}₹${formatPriceInrMt(Math.abs(value))}`;
}
