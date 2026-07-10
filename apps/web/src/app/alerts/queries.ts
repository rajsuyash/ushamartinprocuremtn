import { desc, eq, sql } from "drizzle-orm";

import { getDb } from "@/db/client";
import { alertStatus, alerts, materials, plants, users } from "@/db/schema";

export type AlertStatus = (typeof alertStatus.enumValues)[number];

const LIST_LIMIT = 100;

export interface AlertListRow {
  id: string;
  type: string;
  severity: string;
  materialCode: string | null;
  plantCode: string | null;
  payload: Record<string, unknown>;
  status: AlertStatus;
  recommendationId: string | null;
  ackedByEmail: string | null;
  ackedAt: Date | null;
  createdAt: Date;
}

function extractRecommendationId(payload: unknown): string | null {
  if (payload && typeof payload === "object" && "recommendationId" in payload) {
    const v = (payload as { recommendationId: unknown }).recommendationId;
    return typeof v === "string" ? v : null;
  }
  return null;
}

/** All alerts, newest-first (F7-AC1/AC2/ERR2) — server-component pattern
 * matching /recommendations, /forecasts, /data (queried directly via db
 * rather than the sibling GET /api/alerts route). */
export async function getAlertsList(): Promise<AlertListRow[]> {
  const rows = await getDb()
    .select({
      id: alerts.id,
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
    .leftJoin(materials, eq(materials.id, alerts.materialId))
    .leftJoin(plants, eq(plants.id, alerts.plantId))
    .leftJoin(users, eq(users.id, alerts.ackedBy))
    .orderBy(desc(alerts.createdAt))
    .limit(LIST_LIMIT);

  return rows.map((r) => {
    const payload = (r.payload ?? {}) as Record<string, unknown>;
    return { ...r, payload, recommendationId: extractRecommendationId(payload) };
  });
}

/** Open-alert count for the nav bell (`[data-testid="alert-bell"]`, F7-AC1). */
export async function getOpenAlertCount(): Promise<number> {
  const [row] = await getDb()
    .select({ count: sql<number>`count(*)::int` })
    .from(alerts)
    .where(eq(alerts.status, "OPEN"));
  return row?.count ?? 0;
}
