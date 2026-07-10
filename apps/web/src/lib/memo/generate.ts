import { buildTemplateMemo, type MemoContent } from "./template";
import type { WeekAggregate } from "./aggregate";
import { generateLlmMemo, type GenerateLlmMemoOptions } from "./client";

// F9 memo generation seam (PRD §6 F9). Feature-flagged on ANTHROPIC_API_KEY (ENV-4):
// key present -> LLM path (Anthropic call + schema-validate + retry/timeout fallback,
// in client.ts); key absent -> deterministic template memo with the visible "template
// mode" notice (F9-ERR1). The flag is read here, at call time (per request), never
// cached at module load — the key can be absent/present across requests in dev/test.

export interface GeneratedMemo {
  content: MemoContent;
  mode: "LLM" | "TEMPLATE";
  modelId: string | null;
}

export async function generateMemo(
  aggregate: WeekAggregate,
  opts?: GenerateLlmMemoOptions,
): Promise<GeneratedMemo> {
  if (!process.env.ANTHROPIC_API_KEY) {
    return { content: buildTemplateMemo(aggregate), mode: "TEMPLATE", modelId: null };
  }
  // LLM path owns its own fallback to buildTemplateMemo — it always returns a memo.
  return generateLlmMemo(aggregate, opts);
}
