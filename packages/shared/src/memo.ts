import { z } from "zod";

// F9 weekly-memo OUTPUT contract (PRD §6 F9 output table). This zod schema is the
// single validation gate for LLM output and MUST stay in lockstep with
// `prompts/weekly-memo.schema.json` (the artifact the model is told to match).
// Any LLM output that fails this parse triggers the retry-then-template fallback
// (F9-ERR3) — invalid output never reaches storage or the page.

export const MEMO_HEADLINE_MAX = 120;
export const MEMO_SUMMARY_MAX = 2500;
export const MEMO_KEY_NUMBERS_MAX = 6;
export const MEMO_RISKS_MAX = 4;

// `.strict()` mirrors the schema's `additionalProperties: false` — an LLM that
// smuggles extra keys is rejected, not silently accepted.
export const memoKeyNumberSchema = z
  .object({
    label: z.string().min(1),
    value: z.string().min(1),
  })
  .strict();

export const memoContentSchema = z
  .object({
    headline: z.string().min(1).max(MEMO_HEADLINE_MAX),
    summaryMd: z.string().min(1).max(MEMO_SUMMARY_MAX),
    keyNumbers: z.array(memoKeyNumberSchema).max(MEMO_KEY_NUMBERS_MAX),
    risks: z.array(z.string().min(1)).max(MEMO_RISKS_MAX),
  })
  .strict();

export type MemoContent = z.infer<typeof memoContentSchema>;
