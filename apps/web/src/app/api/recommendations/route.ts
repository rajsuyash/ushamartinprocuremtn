import { ok } from "@pdi/shared";
import { and, desc, eq } from "drizzle-orm";
import type { NextRequest } from "next/server";

import { getDb } from "@/db/client";
import { materials, plants, recommendationStatus, recommendations } from "@/db/schema";
import { withApiAuth } from "@/lib/api-guard";

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

type RecommendationStatus = (typeof recommendationStatus.enumValues)[number];

function isRecommendationStatus(value: string | null): value is RecommendationStatus {
  return !!value && (recommendationStatus.enumValues as readonly string[]).includes(value);
}

function parseLimit(raw: string | null): number {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_LIMIT;
  return Math.min(Math.trunc(n), MAX_LIMIT);
}

// GET /api/recommendations — list, filterable by status/material/plant, newest-first,
// default-limited (known pitfall: list endpoints without pagination). Any authenticated
// role may view (PRD F1 matrix: VIEW = all four).
export const GET = withApiAuth(
  async (req: NextRequest) => {
    const params = req.nextUrl.searchParams;
    const statusFilter = params.get("status");
    const materialFilter = params.get("material");
    const plantFilter = params.get("plant");
    const limit = parseLimit(params.get("limit"));

    const conditions = [];
    if (isRecommendationStatus(statusFilter)) {
      conditions.push(eq(recommendations.status, statusFilter));
    }
    if (materialFilter) {
      conditions.push(eq(materials.code, materialFilter));
    }
    if (plantFilter) {
      conditions.push(eq(plants.code, plantFilter));
    }

    const rows = await getDb()
      .select({
        id: recommendations.id,
        runId: recommendations.runId,
        materialCode: materials.code,
        plantCode: plants.code,
        play: recommendations.play,
        orderLines: recommendations.orderLines,
        expectedImpact: recommendations.expectedImpact,
        rationale: recommendations.rationale,
        status: recommendations.status,
        createdAt: recommendations.createdAt,
      })
      .from(recommendations)
      .innerJoin(materials, eq(materials.id, recommendations.materialId))
      .innerJoin(plants, eq(plants.id, recommendations.plantId))
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(desc(recommendations.createdAt))
      .limit(limit);

    return Response.json(ok({ recommendations: rows }));
  },
  { roles: "authenticated" },
);
