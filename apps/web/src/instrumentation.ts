// Next.js instrumentation hook — register() runs once per server process before any request
// is handled. Used here purely for the ENV-1/ENV-3 fail-fast boot check (PRD §9); the edge
// runtime is skipped since env validation only matters for the long-lived node server.
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { assertBootEnv } = await import("./env");
    assertBootEnv();
  }
}
