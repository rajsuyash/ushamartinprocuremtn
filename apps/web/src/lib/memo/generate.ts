import { buildTemplateMemo, type MemoContent } from "./template";
import type { WeekAggregate } from "./aggregate";

// T32 seam for T33 (PRD §6 F9 "LLM path"). TEMPLATE is the only implementation until
// T33 plugs in the Anthropic client + schema-validate + retry/timeout fallback chain
// in front of it — this function's signature and the mode/modelId shape it returns
// are the contract T33 fills in, not something it needs to rewrite the route for.
//
// Feature flag is read here, at call time (per request), never cached at module
// load — `ANTHROPIC_API_KEY` can be absent/present across requests in dev/test.

export interface GeneratedMemo {
  content: MemoContent;
  mode: "LLM" | "TEMPLATE";
  modelId: string | null;
}

export async function generateMemo(aggregate: WeekAggregate): Promise<GeneratedMemo> {
  if (!process.env.ANTHROPIC_API_KEY) {
    return { content: buildTemplateMemo(aggregate), mode: "TEMPLATE", modelId: null };
  }

  // ponytail: T33 replaces this branch with the Anthropic call + zod-validate +
  // retry(1)/10s-timeout fallback to buildTemplateMemo. Until then, template mode
  // is used even when the key is present — the AC-visible "template mode" notice
  // (F9-ERR1) only requires the key to be absent, so this doesn't fail any T32 AC.
  return { content: buildTemplateMemo(aggregate), mode: "TEMPLATE", modelId: null };
}
