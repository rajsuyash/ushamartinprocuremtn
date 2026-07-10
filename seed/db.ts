import postgres from "postgres";

// Single place that reads DATABASE_URL for the seed + its tests. Mirrors
// apps/web/src/db/client.ts (fail fast with a named error on a missing URL) but is
// standalone so the seed workspace never imports app code. The URL is never logged.
export function makeSql(): postgres.Sql {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error("MISSING_ENV: DATABASE_URL");
  }
  // onnotice off keeps TRUNCATE/CASCADE chatter out of the seed output.
  return postgres(url, { onnotice: () => {} });
}
