import { defineConfig } from "drizzle-kit";

// DATABASE_URL is supplied by the environment (compose postgres in dev). drizzle-kit
// `generate` diffs the TS schema to SQL and needs no connection; `migrate` uses the URL.
export default defineConfig({
  schema: "./src/db/schema/index.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL ?? "",
  },
});
