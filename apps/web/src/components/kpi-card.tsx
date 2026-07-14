// KPI stat card (Stitch ribbon style) — shared by the dashboard ribbon and the
// F10 sandbox. Plain function, server- and client-component compatible.
export function KpiCard({
  label,
  value,
  context,
  risk,
}: {
  label: string;
  value: string;
  context?: string;
  risk?: boolean;
}) {
  return (
    <div
      className={`rounded-xl border border-border bg-surface p-4 ${risk ? "border-l-4 border-l-risk" : ""}`}
    >
      <p className="text-xs font-semibold uppercase tracking-wider text-muted">{label}</p>
      <p className={`mt-2 text-2xl font-semibold ${risk ? "text-risk" : "text-ink"}`}>{value}</p>
      {context ? <p className="mt-1 text-xs text-muted">{context}</p> : null}
    </div>
  );
}
