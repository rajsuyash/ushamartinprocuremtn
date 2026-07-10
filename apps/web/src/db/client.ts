import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import * as schema from "./schema";

// Lazy singleton so importing the schema (typecheck, migrations diff) never opens a
// connection; the pool is created on first query, when DATABASE_URL must be present.
type Client = { db: PostgresJsDatabase<typeof schema>; sql: postgres.Sql };

let cached: Client | null = null;

function connect(): Client {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error("MISSING_ENV: DATABASE_URL");
  }
  const sql = postgres(url);
  return { db: drizzle(sql, { schema }), sql };
}

export function getDb(): PostgresJsDatabase<typeof schema> {
  return (cached ??= connect()).db;
}

export function getSql(): postgres.Sql {
  return (cached ??= connect()).sql;
}
