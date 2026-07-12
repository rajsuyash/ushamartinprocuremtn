import { RunTrigger } from "@/components/upload/run-trigger";
import { UploadPanel } from "@/components/upload/upload-panel";

import { getDatasetStatus } from "./queries";

const TYPES = [
  "purchase_orders",
  "consumption",
  "market_prices",
  "inventory",
] as const;

const TEMPLATE_LABELS: Record<(typeof TYPES)[number], string> = {
  purchase_orders: "Purchase orders",
  consumption: "Consumption",
  market_prices: "Market prices",
  inventory: "Inventory",
};

function formatTimestamp(iso: string | null): string {
  if (!iso) return "never";
  return new Date(iso).toLocaleString("en-IN", {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

// Server component: dataset status (server-side DB counts, F2-AC1), template
// downloads (F2-AC4), and the upload/run client widgets. Data fetched here is
// re-read on every `router.refresh()` the client components trigger after commit.
export default async function DataPage() {
  const status = await getDatasetStatus();
  const byType = new Map(status.map((s) => [s.type, s]));

  return (
    <main className="mx-auto max-w-3xl space-y-8 p-8">
      <div>
        <h1 className="text-lg font-semibold">Data</h1>
        <p className="text-sm text-gray-500">
          Bring in your SAP exports and market prices, then run the weekly analysis.
        </p>
      </div>

      <section data-testid="dataset-status" className="space-y-2">
        <h2 className="text-sm font-medium text-gray-700">Committed data</h2>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {TYPES.map((type) => {
            const s = byType.get(type);
            return (
              <div key={type} className="rounded border border-gray-200 p-3 text-sm">
                <p className="text-gray-500">{TEMPLATE_LABELS[type]}</p>
                <p className="text-lg font-semibold">{s?.committedRows ?? 0}</p>
                <p className="text-xs text-gray-400">
                  last committed: {formatTimestamp(s?.lastCommittedAt ?? null)}
                </p>
              </div>
            );
          })}
        </div>
        <p className="text-sm text-gray-500">
          Already committed for this week?{" "}
          <a href="#run" className="underline">
            Skip to step 3 and trigger a run.
          </a>
        </p>
      </section>

      <section className="space-y-2">
        <h2 className="text-sm font-medium text-gray-700">
          Step 1–2 · Upload, fix errors &amp; commit
        </h2>
        <p className="text-sm text-gray-600">
          Export from SAP (or fill a template) and upload one file per type. Need the format?
        </p>
        <ul className="flex flex-wrap gap-3 text-sm">
          {TYPES.map((type) => (
            <li key={type}>
              <a
                href={`/api/templates/${type}`}
                className="rounded border border-gray-300 px-3 py-1 text-blue-700 underline"
              >
                {TEMPLATE_LABELS[type]} template
              </a>
            </li>
          ))}
        </ul>
        <p className="text-xs text-gray-500">
          Dates: DD-MM-YYYY or YYYY-MM-DD are both accepted; an ambiguous date
          (e.g. 03-04-2026) is assumed DD-MM.
        </p>
        <p className="text-sm text-gray-600">
          After upload you&apos;ll see a validation preview — fix any flagged rows in your file
          and re-upload, then commit the clean data.
        </p>
        <UploadPanel />
      </section>

      <section id="run" className="space-y-2">
        <h2 className="text-sm font-medium text-gray-700">Step 3 · Trigger a run</h2>
        <p className="text-sm text-gray-600">
          A run uses everything committed so far to produce fresh demand forecasts, price
          outlooks and one recommendation per material. When it finishes, results appear on the
          dashboard.
        </p>
        <RunTrigger />
      </section>
    </main>
  );
}
