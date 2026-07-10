import type { FileType } from "@pdi/shared";
import { eq, sql } from "drizzle-orm";

import { getDb } from "@/db/client";
import {
  consumptionRecords,
  inventorySnapshots,
  marketPrices,
  purchaseOrders,
  uploadBatches,
} from "@/db/schema";

// Each target table holds only committed rows — `insertStaged` (staging.ts) writes
// to these tables exclusively from `commitBatch`, never from staging — so a plain
// `count(*)` per table is already the committed count per type; no batch-status
// join needed.
const TABLE_BY_TYPE = {
  purchase_orders: purchaseOrders,
  consumption: consumptionRecords,
  market_prices: marketPrices,
  inventory: inventorySnapshots,
} as const;

const TYPES = Object.keys(TABLE_BY_TYPE) as FileType[];

export interface DatasetTypeStatus {
  type: FileType;
  committedRows: number;
  lastCommittedAt: string | null;
}

/** Dataset status card data (F2-AC1): committed row counts per type + the most
 * recent COMMITTED batch timestamp per type. Four small count queries (tables are
 * demo-scale) plus one grouped max-timestamp query — cheap, no N+1 across rows. */
export async function getDatasetStatus(): Promise<DatasetTypeStatus[]> {
  const db = getDb();

  const counts = await Promise.all(
    TYPES.map(async (type) => {
      const [row] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(TABLE_BY_TYPE[type]);
      return [type, row?.count ?? 0] as const;
    }),
  );

  const lastCommitted = await db
    .select({
      type: uploadBatches.type,
      lastAt: sql<string>`max(${uploadBatches.createdAt})`,
    })
    .from(uploadBatches)
    .where(eq(uploadBatches.status, "COMMITTED"))
    .groupBy(uploadBatches.type);

  const countByType = new Map(counts);
  const lastByType = new Map(lastCommitted.map((r) => [r.type, r.lastAt]));

  return TYPES.map((type) => ({
    type,
    committedRows: countByType.get(type) ?? 0,
    lastCommittedAt: lastByType.get(type) ?? null,
  }));
}
