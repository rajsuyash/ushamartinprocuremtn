import Link from "next/link";

import { recommendationStatus } from "@/db/schema";

import { playChipClass, playChipLabel, statusChipClass } from "./chips";
import {
  getRecommendationFilterOptions,
  getRecommendationsList,
  isRecommendationStatus,
  type RecommendationListRow,
} from "./queries";

interface RecommendationsPageProps {
  searchParams: Promise<{
    status?: string;
    material?: string;
    plant?: string;
    limit?: string;
  }>;
}

const DEFAULT_LIMIT = 50;
const LOAD_MORE_STEP = 50;

// ponytail: recommendations.createdAt is stamped once per run (the persist step
// inserts all of a run's rows together — services/engine's _persist_recommendations),
// so it doubles as "run time" without a join to `runs` just for this column.
function formatRunTime(date: Date): string {
  return date.toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" });
}

// `/recommendations` (F6 list). Server component: filters + rows fetched directly
// via db, matching the /forecasts and /data server-component pattern (task card
// point 1) rather than calling the sibling GET /api/recommendations route.
export default async function RecommendationsPage({ searchParams }: RecommendationsPageProps) {
  const params = await searchParams;
  const status = isRecommendationStatus(params.status) ? params.status : null;
  const material = params.material || null;
  const plant = params.plant || null;
  const requestedLimit = Number(params.limit);
  const limit = Number.isFinite(requestedLimit) && requestedLimit > 0 ? requestedLimit : DEFAULT_LIMIT;

  const [rows, options] = await Promise.all([
    getRecommendationsList({ status, material, plant, limit }),
    getRecommendationFilterOptions(),
  ]);

  function hrefFor(overrides: Record<string, string | null>): string {
    const merged: Record<string, string | null> = {
      status,
      material,
      plant,
      limit: String(limit),
      ...overrides,
    };
    const next = new URLSearchParams();
    for (const [key, value] of Object.entries(merged)) {
      if (value) next.set(key, value);
    }
    const qs = next.toString();
    return qs ? `/recommendations?${qs}` : "/recommendations";
  }

  return (
    <main className="mx-auto max-w-4xl space-y-6 p-8">
      <div>
        <h1 className="text-lg font-semibold">Recommendations</h1>
        <p className="text-sm text-gray-500">
          What PDI suggests you buy — approve, change, or reject each one.
        </p>
      </div>

      <div className="flex flex-wrap gap-6 text-sm" data-testid="recommendation-filters">
        <FilterGroup
          label="Status"
          testId="filter-status"
          options={recommendationStatus.enumValues}
          selected={status}
          hrefFor={(value) => hrefFor({ status: value, limit: null })}
        />
        <FilterGroup
          label="Material"
          testId="filter-material"
          options={options.materials}
          selected={material}
          hrefFor={(value) => hrefFor({ material: value, limit: null })}
        />
        <FilterGroup
          label="Plant"
          testId="filter-plant"
          options={options.plants}
          selected={plant}
          hrefFor={(value) => hrefFor({ plant: value, limit: null })}
        />
      </div>

      {rows.length === 0 ? (
        <p className="text-sm text-gray-500" data-testid="recommendations-empty">
          No recommendations match these filters.
        </p>
      ) : (
        <RecommendationsTable rows={rows} />
      )}

      {rows.length === limit ? (
        <Link
          href={hrefFor({ limit: String(limit + LOAD_MORE_STEP) })}
          className="text-sm text-blue-700 underline"
          data-testid="load-more"
        >
          Load more
        </Link>
      ) : null}
    </main>
  );
}

function FilterGroup({
  label,
  testId,
  options,
  selected,
  hrefFor,
}: {
  label: string;
  testId: string;
  options: readonly string[];
  selected: string | null;
  hrefFor: (value: string | null) => string;
}) {
  if (options.length === 0) return null;
  return (
    <div className="space-y-1" data-testid={testId}>
      <p className="text-xs font-medium text-gray-500">{label}</p>
      <div className="flex flex-wrap gap-2">
        <FilterLink href={hrefFor(null)} active={selected === null}>
          All
        </FilterLink>
        {options.map((opt) => (
          <FilterLink key={opt} href={hrefFor(opt)} active={selected === opt}>
            {opt}
          </FilterLink>
        ))}
      </div>
    </div>
  );
}

function FilterLink({
  href,
  active,
  children,
}: {
  href: string;
  active: boolean;
  children: string;
}) {
  return (
    <Link
      href={href}
      aria-current={active ? "true" : undefined}
      className={
        active
          ? "rounded-full bg-gray-900 px-3 py-1 text-white"
          : "rounded-full border border-gray-300 px-3 py-1 text-gray-700 hover:bg-gray-50"
      }
    >
      {children}
    </Link>
  );
}

function RecommendationsTable({ rows }: { rows: RecommendationListRow[] }) {
  return (
    <table data-testid="recommendations-table" className="w-full border-collapse text-left text-sm">
      <thead>
        <tr className="border-b border-gray-200 text-gray-500">
          <th className="py-2 pr-4 font-medium">Material · Plant</th>
          <th className="py-2 pr-4 font-medium">Play</th>
          <th className="py-2 pr-4 font-medium">Status</th>
          <th className="py-2 pr-4 font-medium">Run time</th>
          <th className="py-2 font-medium" />
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.id} className="border-b border-gray-100">
            <td className="py-2 pr-4">
              {row.materialCode} · {row.plantCode}
            </td>
            <td className="py-2 pr-4">
              <span
                className={`inline-block rounded-full px-3 py-1 text-xs font-medium ${playChipClass(row.play)}`}
              >
                {playChipLabel(row.play)}
              </span>
            </td>
            <td className="py-2 pr-4">
              <span
                className={`inline-block rounded-full px-3 py-1 text-xs font-medium ${statusChipClass(row.status)}`}
              >
                {row.status}
              </span>
            </td>
            <td className="py-2 pr-4">{formatRunTime(row.createdAt)}</td>
            <td className="py-2">
              <Link href={`/recommendations/${row.id}`} className="text-blue-700 underline">
                View
              </Link>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
