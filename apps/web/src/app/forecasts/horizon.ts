// Anchors a price-forecast horizon (in weeks) onto a calendar date after the
// last history week — entirely in UTC (known-pitfalls.md: never let JS Date
// shift a business DATE across a local timezone). F4-AC2: the 3 horizons
// (1w/4w/12w) become 3 forecast points plotted at +1w/+4w/+12w from history end.
export function addWeeksToIsoDate(isoDate: string, weeks: number): string {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + weeks * 7);
  return d.toISOString().slice(0, 10);
}
