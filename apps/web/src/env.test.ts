import { afterEach, describe, expect, it } from "vitest";
import { assertBootEnv, getEngineUrl, MissingEnvError } from "./env";

const ORIGINAL_ENV = { ...process.env };

describe("env.ts boot fail-fast (PRD §9 ENV-1, ENV-3)", () => {
  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  it("throws a named MISSING_ENV error when DATABASE_URL is absent", () => {
    delete process.env.DATABASE_URL;
    process.env.AUTH_SECRET = "test-secret";

    expect(() => assertBootEnv()).toThrow(MissingEnvError);
    expect(() => assertBootEnv()).toThrow("MISSING_ENV: DATABASE_URL");
  });

  it("throws a named MISSING_ENV error when AUTH_SECRET is absent", () => {
    process.env.DATABASE_URL = "postgresql://localhost/testdb";
    delete process.env.AUTH_SECRET;

    expect(() => assertBootEnv()).toThrow(MissingEnvError);
    expect(() => assertBootEnv()).toThrow("MISSING_ENV: AUTH_SECRET");
  });

  it("does not throw when both required vars are present", () => {
    process.env.DATABASE_URL = "postgresql://localhost/testdb";
    process.env.AUTH_SECRET = "test-secret";

    expect(() => assertBootEnv()).not.toThrow();
  });

  it("reads ENGINE_URL lazily without requiring it at boot", () => {
    delete process.env.ENGINE_URL;
    expect(getEngineUrl()).toBeUndefined();

    process.env.ENGINE_URL = "http://engine:8000";
    expect(getEngineUrl()).toBe("http://engine:8000");
  });
});
