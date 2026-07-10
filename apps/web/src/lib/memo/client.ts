import { readFileSync } from "node:fs";
import path from "node:path";

import { memoContentSchema, type MemoContent } from "@pdi/shared";

import type { WeekAggregate } from "./aggregate";
import { buildTemplateMemo } from "./template";
import type { GeneratedMemo } from "./generate";

// T33 · F9 LLM path (PRD §6 F9 AI-behavior table). This module turns the week
// aggregate into a schema-valid memo via the Anthropic API, with a strict fallback
// chain: 10s timeout, ONE retry on any failure (timeout | API error | schema-invalid),
// then the deterministic template memo (F9-ERR2/ERR3). It is never an error dead-end.
//
// The model transport is INJECTABLE (opts.transport) so tests exercise the whole
// retry/validate/fallback machine without a real API call or global monkey-patching.

export const DEFAULT_MEMO_MODEL = "claude-sonnet-4-6";
const TIMEOUT_MS = 10_000;
const MAX_ATTEMPTS = 2; // initial + 1 retry (PRD F9 "retry once")
const MAX_TOKENS = 2048; // headroom for a ≤2500-char summaryMd + the rest of the JSON
const INVALID_PAYLOAD_LOG_CHARS = 500;

// Repo-root prompt artifact. cwd is `apps/web` under both `next` (dev/prod) and
// vitest, so ../../ reaches the repo root. Read at call time, cached after first read.
const PROMPT_PATH = path.resolve(process.cwd(), "..", "..", "prompts", "weekly-memo.md");
let cachedPrompt: string | null = null;

/** Loads the F9 system prompt from `prompts/weekly-memo.md`. No data is ever
 * interpolated here — the aggregate travels only in the user message. */
export function loadSystemPrompt(promptPath: string = PROMPT_PATH): string {
  if (promptPath === PROMPT_PATH && cachedPrompt !== null) return cachedPrompt;
  const text = readFileSync(promptPath, "utf8").trim();
  if (!text) throw new Error(`MEMO_PROMPT_EMPTY: ${promptPath}`);
  if (promptPath === PROMPT_PATH) cachedPrompt = text;
  return text;
}

/** Model transport: given a fully-assembled request, return the model's raw text
 * output. Kept minimal + injectable so tests never touch the Anthropic SDK. */
export interface MemoTransportRequest {
  model: string;
  system: string;
  user: string;
  maxTokens: number;
  signal: AbortSignal;
}
export type MemoTransport = (req: MemoTransportRequest) => Promise<string>;

export interface GenerateLlmMemoOptions {
  transport?: MemoTransport;
  timeoutMs?: number;
}

/** Real transport — lazily imports the SDK so it only loads on an actual live call
 * (never in unit tests, which inject their own transport). */
const defaultTransport: MemoTransport = async (req) => {
  const { default: Anthropic } = await import("@anthropic-ai/sdk");
  const client = new Anthropic({
    apiKey: process.env.ANTHROPIC_API_KEY,
    maxRetries: 0, // retry is owned by this module, not the SDK
  });
  const message = await client.messages.create(
    {
      model: req.model,
      max_tokens: req.maxTokens,
      system: req.system,
      messages: [{ role: "user", content: req.user }],
    },
    { signal: req.signal },
  );
  return message.content
    .map((block) => (block.type === "text" ? block.text : ""))
    .join("");
};

/** Runs one transport call with a hard timeout; aborts the request when it fires so
 * a slow API cannot hang the memo route past the budget (F9-ERR2). */
async function callWithTimeout(
  transport: MemoTransport,
  req: Omit<MemoTransportRequest, "signal">,
  timeoutMs: number,
): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await Promise.race([
      transport({ ...req, signal: controller.signal }),
      new Promise<never>((_, reject) => {
        controller.signal.addEventListener("abort", () =>
          reject(new Error("MEMO_TIMEOUT")),
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

/** Parse + schema-validate one raw model output. Throws on invalid JSON or schema
 * violation so the caller treats it as a failed attempt (retry, then fallback). */
function parseMemoOutput(raw: string): MemoContent {
  const json: unknown = JSON.parse(raw);
  return memoContentSchema.parse(json);
}

function logInvalidPayload(attempt: number, raw: string): void {
  // Truncated invalid payload for eval improvement (F9-ERR3). Never the prompt/aggregate.
  console.warn(
    JSON.stringify({
      level: "warn",
      event: "memo_invalid_payload",
      attempt,
      payload: raw.slice(0, INVALID_PAYLOAD_LOG_CHARS),
    }),
  );
}

function logCall(mode: GeneratedMemo["mode"], modelId: string | null, latencyMs: number, attempts: number): void {
  // One structured line per generateMemo call — mode, model, latency, attempts.
  // Never the full prompt or aggregate (PRD §11 observability + F9 safety).
  console.info(
    JSON.stringify({ level: "info", event: "memo_generate", mode, modelId, latencyMs, attempts }),
  );
}

/**
 * F9 LLM memo generation with the full fallback chain. Assembles the request from
 * files + the aggregate, calls the model with a 10s timeout, retries once on any
 * failure, validates the output against the schema contract, and falls back to the
 * deterministic template memo if every attempt fails — always returning a memo.
 */
export async function generateLlmMemo(
  aggregate: WeekAggregate,
  opts: GenerateLlmMemoOptions = {},
): Promise<GeneratedMemo> {
  const transport = opts.transport ?? defaultTransport;
  const timeoutMs = opts.timeoutMs ?? TIMEOUT_MS;
  const model = process.env.MEMO_MODEL || DEFAULT_MEMO_MODEL;

  const req: Omit<MemoTransportRequest, "signal"> = {
    model,
    system: loadSystemPrompt(),
    user: JSON.stringify(aggregate),
    maxTokens: MAX_TOKENS,
  };

  const startedAt = Date.now();
  let attempts = 0;

  while (attempts < MAX_ATTEMPTS) {
    attempts += 1;
    try {
      const raw = await callWithTimeout(transport, req, timeoutMs);
      let content: MemoContent;
      try {
        content = parseMemoOutput(raw);
      } catch (parseErr) {
        logInvalidPayload(attempts, raw);
        throw parseErr;
      }
      logCall("LLM", model, Date.now() - startedAt, attempts);
      return { content, mode: "LLM", modelId: model };
    } catch {
      // Timeout | API error | schema-invalid — retry until MAX_ATTEMPTS, then fall back.
    }
  }

  logCall("TEMPLATE", null, Date.now() - startedAt, attempts);
  return { content: buildTemplateMemo(aggregate), mode: "TEMPLATE", modelId: null };
}
