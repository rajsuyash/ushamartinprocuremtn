import { pathToFileURL } from "node:url";

import type postgres from "postgres";

import { makeSql } from "./db";
import { seedDataset, type DatasetCounts } from "./dataset";
import { seedUsers } from "./users";

// Every data table, in one TRUNCATE … CASCADE so a reseed is a clean wipe+reload
// regardless of FK direction. Analytical/decision tables (runs, forecasts, recs,
// decisions, alerts, memos) are emptied too so the demo starts from a pristine
// pre-run state, exactly reproducible on every `pnpm seed`.
const ALL_TABLES = [
  "users",
  "plants",
  "materials",
  "suppliers",
  "policy_configs",
  "upload_batches",
  "purchase_orders",
  "consumption_records",
  "inventory_snapshots",
  "market_prices",
  "runs",
  "demand_forecasts",
  "price_forecasts",
  "recommendations",
  "decision_records",
  "alerts",
  "memos",
];

async function wipe(sql: postgres.Sql): Promise<void> {
  await sql`truncate table ${sql.unsafe(ALL_TABLES.join(", "))} restart identity cascade`;
}

export interface SeedCounts extends DatasetCounts {
  users: number;
}

/** Idempotent full seed against an open connection. Wipe → users → dataset. */
export async function runSeed(sql: postgres.Sql): Promise<SeedCounts> {
  await wipe(sql);
  const { adminId } = await seedUsers(sql);
  const dataset = await seedDataset(sql, adminId);
  return { users: 4, ...dataset };
}

async function main(): Promise<void> {
  const sql = makeSql();
  try {
    const counts = await runSeed(sql);
    // Deterministic, secret-free summary — no URLs, no hashes, no credentials.
    console.log("pnpm seed — done. Row counts:");
    for (const [k, v] of Object.entries(counts)) console.log(`  ${k.padEnd(16)} ${v}`);
  } finally {
    await sql.end();
  }
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  main().catch((err: unknown) => {
    console.error(err instanceof Error ? `${err.name}: ${err.message}` : String(err));
    process.exit(1);
  });
}
