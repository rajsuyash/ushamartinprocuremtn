// Qty (MT) formatting: 1–3 decimals, trailing zeros trimmed but at least one kept.
// Deliberately NOT Intl/locale-based (unlike money, which uses en-IN grouping per
// conventions.md) — a locale-dependent format here would be a hydration hazard if
// ever rendered client-side with a different Accept-Language (known-pitfalls.md).
export function formatQtyMt(value: number | string | null | undefined): string {
  if (value === null || value === undefined) return "—";
  const n = typeof value === "string" ? Number(value) : value;
  if (!Number.isFinite(n)) return "—";

  const fixed = n.toFixed(3).replace(/(\.\d*?)0+$/, "$1").replace(/\.$/, ".0");
  return fixed;
}
