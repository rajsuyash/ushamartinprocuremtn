import type { DecisionActionInput } from "@pdi/shared";
import { and, desc, eq } from "drizzle-orm";

import { getDb } from "@/db/client";
import { decisionRecords, materials, plants, recommendationStatus, recommendations, users } from "@/db/schema";

import type { RecommendationRationale } from "@/app/tile-logic";

export type RecommendationStatus = (typeof recommendationStatus.enumValues)[number];

export function isRecommendationStatus(
  value: string | null | undefined,
): value is RecommendationStatus {
  return !!value && (recommendationStatus.enumValues as readonly string[]).includes(value);
}

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

export interface RecommendationListFilters {
  status?: string | null;
  material?: string | null;
  plant?: string | null;
  limit?: number;
}

export interface RecommendationListRow {
  id: string;
  materialCode: string;
  plantCode: string;
  play: string | null;
  status: RecommendationStatus;
  createdAt: Date;
}

/** List rows for `/recommendations` — same filter semantics (status/material/plant,
 * default-limited) as `GET /api/recommendations`, queried directly via Drizzle per
 * the server-component pattern established in /forecasts and /data (task card
 * point 1; known pitfall: list endpoints without pagination — limit is bounded). */
export async function getRecommendationsList(
  filters: RecommendationListFilters,
): Promise<RecommendationListRow[]> {
  const db = getDb();
  const conditions = [];
  if (isRecommendationStatus(filters.status)) {
    conditions.push(eq(recommendations.status, filters.status));
  }
  if (filters.material) conditions.push(eq(materials.code, filters.material));
  if (filters.plant) conditions.push(eq(plants.code, filters.plant));

  return db
    .select({
      id: recommendations.id,
      materialCode: materials.code,
      plantCode: plants.code,
      play: recommendations.play,
      status: recommendations.status,
      createdAt: recommendations.createdAt,
    })
    .from(recommendations)
    .innerJoin(materials, eq(materials.id, recommendations.materialId))
    .innerJoin(plants, eq(plants.id, recommendations.plantId))
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(recommendations.createdAt))
    .limit(
      filters.limit && Number.isFinite(filters.limit) && filters.limit > 0
        ? Math.min(Math.trunc(filters.limit), MAX_LIMIT)
        : DEFAULT_LIMIT,
    );
}

export interface RecommendationFilterOptions {
  materials: string[];
  plants: string[];
}

/** Material/plant codes that have at least one recommendation — filter option
 * source for the list page (mirrors forecasts/queries.ts's getSeriesOptions). */
export async function getRecommendationFilterOptions(): Promise<RecommendationFilterOptions> {
  const db = getDb();
  const materialRows = await db
    .selectDistinct({ code: materials.code })
    .from(materials)
    .innerJoin(recommendations, eq(recommendations.materialId, materials.id))
    .orderBy(materials.code);
  const plantRows = await db
    .selectDistinct({ code: plants.code })
    .from(plants)
    .innerJoin(recommendations, eq(recommendations.plantId, plants.id))
    .orderBy(plants.code);
  return {
    materials: materialRows.map((r) => r.code),
    plants: plantRows.map((r) => r.code),
  };
}

export interface OrderLine {
  supplierCode: string;
  qtyMt: number;
  targetWeek: string;
  estPriceInrMt: number;
}

export interface ExpectedImpact {
  costDeltaInr: number;
  costDeltaP10Inr: number;
  costDeltaP90Inr: number;
  wcDeltaInr: number;
  coverAfterDays: number;
}

export interface DecisionAudit {
  action: DecisionActionInput;
  note: string;
  override: { play: string } | null;
  decidedByEmail: string;
  decidedAt: Date;
}

export interface RecommendationDetail {
  id: string;
  runId: string;
  materialCode: string;
  plantCode: string;
  play: string | null;
  status: RecommendationStatus;
  orderLines: OrderLine[];
  expectedImpact: ExpectedImpact | null;
  rationale: RecommendationRationale;
  createdAt: Date;
  decision: DecisionAudit | null;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Full detail for `/recommendations/:id`, rendered ENTIRELY from the stored E13
 * row (known pitfall: render rationale from the stored JSON, never recomputed).
 * Returns null for a malformed or unknown id — the page 404s either way (task
 * card point 2). If a DecisionRecord exists it's included read-only (T25/T26
 * own writing decisions; this page only displays the resulting audit line). */
export async function getRecommendationDetail(
  id: string,
): Promise<RecommendationDetail | null> {
  if (!UUID_RE.test(id)) return null;

  const db = getDb();
  const [row] = await db
    .select({
      id: recommendations.id,
      runId: recommendations.runId,
      materialCode: materials.code,
      plantCode: plants.code,
      play: recommendations.play,
      status: recommendations.status,
      orderLines: recommendations.orderLines,
      expectedImpact: recommendations.expectedImpact,
      rationale: recommendations.rationale,
      createdAt: recommendations.createdAt,
    })
    .from(recommendations)
    .innerJoin(materials, eq(materials.id, recommendations.materialId))
    .innerJoin(plants, eq(plants.id, recommendations.plantId))
    .where(eq(recommendations.id, id))
    .limit(1);

  if (!row) return null;

  const [decisionRow] = await db
    .select({
      action: decisionRecords.action,
      note: decisionRecords.note,
      override: decisionRecords.override,
      decidedAt: decisionRecords.decidedAt,
      decidedByEmail: users.email,
    })
    .from(decisionRecords)
    .innerJoin(users, eq(users.id, decisionRecords.decidedBy))
    .where(eq(decisionRecords.recommendationId, id))
    .limit(1);

  const expectedImpact = (row.expectedImpact ?? {}) as ExpectedImpact | Record<string, never>;
  const hasImpact = "costDeltaInr" in expectedImpact;

  return {
    id: row.id,
    runId: row.runId,
    materialCode: row.materialCode,
    plantCode: row.plantCode,
    play: row.play,
    status: row.status,
    orderLines: (row.orderLines ?? []) as OrderLine[],
    expectedImpact: hasImpact ? (expectedImpact as ExpectedImpact) : null,
    rationale: (row.rationale ?? {}) as RecommendationRationale,
    createdAt: row.createdAt,
    decision: decisionRow
      ? { ...decisionRow, override: (decisionRow.override ?? null) as { play: string } | null }
      : null,
  };
}
