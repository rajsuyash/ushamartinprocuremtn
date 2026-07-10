import { ok } from "@pdi/shared";
import { and, desc, eq } from "drizzle-orm";
import type { NextRequest } from "next/server";

import { getDb } from "@/db/client";
import { alertStatus, alerts, materials, plants, users } from "@/db/schema";
import { withApiAuth } from "@/lib/api-guard";

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

type AlertStatus = (typeof alertStatus.enumValues)[number];

function isAlertStatus(value: string | null): value is AlertStatus {
  return !!value && (alertStatus.enumValues as readonly string[]).includes(value);
}

function parseLimit(raw: string | null): number {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_LIMIT;
  return Math.min(Math.trunc(n), MAX_LIMIT);
}

// GET /api/alerts — list, filterable by status (OPEN|ACKED), newest-first,
// default-limited (known pitfall: list endpoints without pagination). Any
// authenticated role may view (PRD F1 matrix: VIEW = all four).
export const GET = withApiAuth(
  async (req: NextRequest) => {
    const params = req.nextUrl.searchParams;
    const statusFilter = params.get("status");
    const limit = parseLimit(params.get("limit"));

    const conditions = [];
    if (isAlertStatus(statusFilter)) {
      conditions.push(eq(alerts.status, statusFilter));
    }

    const rows = await getDb()
      .select({
        id: alerts.id,
        runId: alerts.runId,
        type: alerts.type,
        severity: alerts.severity,
        materialCode: materials.code,
        plantCode: plants.code,
        payload: alerts.payload,
        status: alerts.status,
        ackedByEmail: users.email,
        ackedAt: alerts.ackedAt,
        createdAt: alerts.createdAt,
      })
      .from(alerts)
      // material/plant are nullable (portfolio-wide alerts, PRD §7 E15) — left join.
      .leftJoin(materials, eq(materials.id, alerts.materialId))
      .leftJoin(plants, eq(plants.id, alerts.plantId))
      .leftJoin(users, eq(users.id, alerts.ackedBy))
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(desc(alerts.createdAt))
      .limit(limit);

    return Response.json(ok({ alerts: rows }));
  },
  { roles: "authenticated" },
);
