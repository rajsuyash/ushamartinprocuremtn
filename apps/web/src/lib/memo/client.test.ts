import { readFileSync } from "node:fs";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { WeekAggregate } from "./aggregate";
import {
  DEFAULT_MEMO_MODEL,
  generateLlmMemo,
  loadSystemPrompt,
  type MemoTransport,
  type MemoTransportRequest,
} from "./client";
import { generateMemo } from "./generate";

// T33 · F9 LLM path (PRD §6 F9 AI-behavior table). NO real API calls — every test
// injects a fake transport, so the retry/timeout/validate/fallback machine is
// exercised deterministically without touching the Anthropic SDK or globals.

const PERIOD_START = "2026-07-04";

const AGGREGATE: WeekAggregate = {
  period: { start: PERIOD_START, end: "2026-07-10" },
  runs: 2,
  recommendationsByPlay: {
    BUY_NOW: 1,
    WAIT: 1,
    PARTIAL_BUY: 0,
    HEDGE_LOCK: 0,
    SPLIT_SUPPLIERS: 0,
  },
  decisions: { APPROVE: 1, OVERRIDE: 0, REJECT: 0 },
  valueInr: 1_830_000,
  alerts: { byType: { COVER_BREACH: 1 }, bySeverity: { CRITICAL: 1 } },
  forecastQuality: {
    wape: [{ materialCode: "WR-5.5-HC", plantCode: "RNC", model: "lightgbm", backtestWape: 0.13 }],
    coverage: [{ gradeFamily: "WR-STD", coverage8090: 0.83 }],
  },
};

const VALID_MEMO = {
  headline: "Wire-rod: 1 buy approved, 1 critical alert open",
  summaryMd: "Two runs this week. One BUY_NOW approved. One critical cover alert open.",
  keyNumbers: [
    { label: "Runs", value: "2" },
    { label: "Value", value: "₹ 18.3 lakh" },
  ],
  risks: ["1 critical cover alert open."],
};

// Silence structured log lines; individual tests re-inspect the spies they need.
let warnSpy: ReturnType<typeof vi.spyOn>;
let infoSpy: ReturnType<typeof vi.spyOn>;
const ORIGINAL_MEMO_MODEL = process.env.MEMO_MODEL;

beforeEach(() => {
  warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
  infoSpy = vi.spyOn(console, "info").mockImplementation(() => {});
  delete process.env.MEMO_MODEL;
});

afterEach(() => {
  warnSpy.mockRestore();
  infoSpy.mockRestore();
  if (ORIGINAL_MEMO_MODEL === undefined) delete process.env.MEMO_MODEL;
  else process.env.MEMO_MODEL = ORIGINAL_MEMO_MODEL;
});

const okTransport = (out: unknown = VALID_MEMO): MemoTransport =>
  vi.fn(async () => JSON.stringify(out));

describe("generateLlmMemo — happy path", () => {
  it("valid JSON output → mode LLM with the pinned model id (F9-AC1)", async () => {
    const transport = okTransport();
    const result = await generateLlmMemo(AGGREGATE, { transport });

    expect(result.mode).toBe("LLM");
    expect(result.modelId).toBe(DEFAULT_MEMO_MODEL);
    expect(result.content.headline).toBe(VALID_MEMO.headline);
    expect(transport).toHaveBeenCalledTimes(1);
  });

  it("uses MEMO_MODEL env when set", async () => {
    process.env.MEMO_MODEL = "claude-opus-4-8";
    const result = await generateLlmMemo(AGGREGATE, { transport: okTransport() });
    expect(result.modelId).toBe("claude-opus-4-8");
  });

  it("sends the file system prompt + aggregate as the user message, no data in the prompt", async () => {
    let seen: MemoTransportRequest | undefined;
    const transport: MemoTransport = vi.fn(async (req) => {
      seen = req;
      return JSON.stringify(VALID_MEMO);
    });

    await generateLlmMemo(AGGREGATE, { transport });

    expect(seen).toBeDefined();
    // System prompt is the file verbatim — aggregate data never interpolated into it.
    expect(seen!.system).toBe(loadSystemPrompt());
    expect(seen!.system).not.toContain(PERIOD_START);
    // The aggregate travels only in the user message.
    expect(seen!.user).toContain(PERIOD_START);
    expect(JSON.parse(seen!.user)).toEqual(AGGREGATE);
  });
});

describe("generateLlmMemo — fallback chain", () => {
  it("timeout → 1 retry → template fallback, mode TEMPLATE (F9-ERR2)", async () => {
    // Never resolves; the internal 10s→(here 20ms) timeout aborts and rejects.
    const transport: MemoTransport = vi.fn(() => new Promise<string>(() => {}));

    const result = await generateLlmMemo(AGGREGATE, { transport, timeoutMs: 20 });

    expect(result.mode).toBe("TEMPLATE");
    expect(result.modelId).toBeNull();
    expect(result.content.headline).toEqual(expect.any(String));
    expect(transport).toHaveBeenCalledTimes(2); // initial + exactly one retry
  });

  it("invalid JSON → retry → template fallback, truncated payload logged (F9-ERR3)", async () => {
    const bad = "x".repeat(900); // not JSON, longer than the 500-char log cap
    const transport: MemoTransport = vi.fn(async () => bad);

    const result = await generateLlmMemo(AGGREGATE, { transport });

    expect(result.mode).toBe("TEMPLATE");
    expect(transport).toHaveBeenCalledTimes(2);

    const logged = warnSpy.mock.calls
      .map((c: unknown[]) => String(c[0]))
      .find((s: string) => s.includes("memo_invalid_payload"));
    expect(logged).toBeDefined();
    const parsed = JSON.parse(logged!);
    expect(parsed.event).toBe("memo_invalid_payload");
    expect(parsed.payload.length).toBeLessThanOrEqual(500);
  });

  it("schema-violating JSON (headline > 120 chars) → template fallback", async () => {
    const oversize = { ...VALID_MEMO, headline: "H".repeat(121) };
    const transport = okTransport(oversize);

    const result = await generateLlmMemo(AGGREGATE, { transport });

    expect(result.mode).toBe("TEMPLATE");
    expect(transport).toHaveBeenCalledTimes(2);
  });

  it("schema-violating JSON (extra field) → template fallback (strict schema)", async () => {
    const transport = okTransport({ ...VALID_MEMO, extra: "smuggled" });
    const result = await generateLlmMemo(AGGREGATE, { transport });
    expect(result.mode).toBe("TEMPLATE");
  });

  it("retry cap respected — a persistently failing transport is called exactly twice", async () => {
    const transport: MemoTransport = vi.fn(async () => {
      throw new Error("API_ERROR");
    });

    const result = await generateLlmMemo(AGGREGATE, { transport });

    expect(result.mode).toBe("TEMPLATE");
    expect(transport).toHaveBeenCalledTimes(2);
  });

  it("recovers on the retry — first attempt fails, second returns valid JSON → mode LLM", async () => {
    let call = 0;
    const transport: MemoTransport = vi.fn(async () => {
      call += 1;
      if (call === 1) throw new Error("transient");
      return JSON.stringify(VALID_MEMO);
    });

    const result = await generateLlmMemo(AGGREGATE, { transport });

    expect(result.mode).toBe("LLM");
    expect(transport).toHaveBeenCalledTimes(2);
  });
});

describe("loadSystemPrompt", () => {
  it("loads a non-empty prompt from prompts/weekly-memo.md", () => {
    const text = loadSystemPrompt();
    expect(text.length).toBeGreaterThan(0);
    // Matches the on-disk artifact (proves it reads the file, not a literal).
    const onDisk = readFileSync(
      path.resolve(process.cwd(), "..", "..", "prompts", "weekly-memo.md"),
      "utf8",
    ).trim();
    expect(text).toBe(onDisk);
  });
});

describe("generateMemo — feature flag wiring (ENV-4)", () => {
  const ORIGINAL_KEY = process.env.ANTHROPIC_API_KEY;

  afterEach(() => {
    if (ORIGINAL_KEY === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = ORIGINAL_KEY;
  });

  it("key absent → TEMPLATE, transport never called (F9-ERR1)", async () => {
    delete process.env.ANTHROPIC_API_KEY;
    const transport = okTransport();

    const result = await generateMemo(AGGREGATE, { transport });

    expect(result.mode).toBe("TEMPLATE");
    expect(result.modelId).toBeNull();
    expect(transport).not.toHaveBeenCalled();
  });

  it("key present → LLM path via injected transport", async () => {
    process.env.ANTHROPIC_API_KEY = "test-key-not-real";
    const transport = okTransport();

    const result = await generateMemo(AGGREGATE, { transport });

    expect(result.mode).toBe("LLM");
    expect(transport).toHaveBeenCalledTimes(1);
  });
});
