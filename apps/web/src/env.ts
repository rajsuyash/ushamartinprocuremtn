// Fail-fast env validation per PRD §9. DATABASE_URL (ENV-1) and AUTH_SECRET (ENV-3) are
// boot-required — the app refuses to start without them. ENGINE_URL (ENV-2) is deliberately
// NOT boot-required: a missing/unreachable engine fails individual runs with ENGINE_UNAVAILABLE
// rather than blocking the whole app from starting, so it's read lazily via getEngineUrl().

export class MissingEnvError extends Error {
  constructor(public readonly varName: string) {
    super(`MISSING_ENV: ${varName}`);
    this.name = "MissingEnvError";
  }
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new MissingEnvError(name);
  }
  return value;
}

/** Call once at server startup (see instrumentation.ts). Throws MissingEnvError on any gap. */
export function assertBootEnv(): void {
  requireEnv("DATABASE_URL");
  requireEnv("AUTH_SECRET");
}

/** Lazy read — no boot-time requirement. Undefined means callers must fail with ENGINE_UNAVAILABLE. */
export function getEngineUrl(): string | undefined {
  return process.env.ENGINE_URL;
}
