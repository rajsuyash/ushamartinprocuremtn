import Link from "next/link";

import { AckButton } from "./ack-button";
import { severityChipClass, summarizeAlertPayload } from "./format";
import { getAlertsList, type AlertListRow } from "./queries";

function formatTimestamp(date: Date | null): string {
  if (!date) return "—";
  return date.toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" });
}

// `/alerts` (F7). Server component: all alerts fetched directly via db (same
// pattern as /recommendations, /forecasts, /data), split into Open (actionable,
// F7-AC1) and Acknowledged (audit trail, F7-AC2) sections. Empty state renders
// cleanly with zero alerts (F7-ERR2).
export default async function AlertsPage() {
  const rows = await getAlertsList();
  const open = rows.filter((r) => r.status === "OPEN");
  const acked = rows.filter((r) => r.status === "ACKED");

  return (
    <main className="mx-auto max-w-4xl space-y-8 p-8">
      <h1 className="text-lg font-semibold">Alerts</h1>

      {rows.length === 0 ? (
        <p className="text-sm text-gray-500" data-testid="alerts-empty">
          No alerts.
        </p>
      ) : (
        <>
          <section className="space-y-3" data-testid="alerts-open">
            <h2 className="text-sm font-medium text-gray-700">Open</h2>
            {open.length === 0 ? (
              <p className="text-sm text-gray-500">No open alerts.</p>
            ) : (
              <ul className="space-y-2">
                {open.map((a) => (
                  <AlertRow key={a.id} alert={a} />
                ))}
              </ul>
            )}
          </section>

          {acked.length > 0 ? (
            <section className="space-y-3" data-testid="alerts-acked">
              <h2 className="text-sm font-medium text-gray-700">Acknowledged</h2>
              <ul className="space-y-2">
                {acked.map((a) => (
                  <AlertRow key={a.id} alert={a} />
                ))}
              </ul>
            </section>
          ) : null}
        </>
      )}
    </main>
  );
}

function AlertRow({ alert }: { alert: AlertListRow }) {
  return (
    <li
      data-testid={`alert-${alert.id}`}
      className="flex items-start justify-between gap-4 rounded border border-gray-200 p-3 text-sm"
    >
      <div className="space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          <span
            className={`inline-block rounded-full px-3 py-1 text-xs font-medium ${severityChipClass(alert.severity)}`}
          >
            {alert.severity}
          </span>
          <span className="font-medium text-gray-900">{alert.type}</span>
          {alert.materialCode && alert.plantCode ? (
            <span className="text-gray-500">
              {alert.materialCode} · {alert.plantCode}
            </span>
          ) : null}
        </div>

        <p className="text-gray-700">{summarizeAlertPayload(alert.type, alert.payload)}</p>

        {alert.recommendationId ? (
          <Link
            href={`/recommendations/${alert.recommendationId}`}
            className="block text-xs text-blue-700 underline"
          >
            View recommendation
          </Link>
        ) : null}

        {alert.status === "ACKED" ? (
          <p className="text-xs text-gray-500">
            Acknowledged by {alert.ackedByEmail} at {formatTimestamp(alert.ackedAt)}
          </p>
        ) : null}
      </div>

      {alert.status === "OPEN" ? <AckButton alertId={alert.id} /> : null}
    </li>
  );
}
