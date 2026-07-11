#!/usr/bin/env node
// Thin eval runner: load cases → call feature entrypoint → schema-validate → score → JSON report.
// Usage: node evals/run.mjs memo
// ponytail: single-feature runner, no framework; extend only when a second AI feature exists.
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";

const feature = process.argv[2];
if (!feature) {
  console.error("usage: node evals/run.mjs <feature>");
  process.exit(1);
}

const dir = path.join("evals", feature);
const cases = readFileSync(path.join(dir, "cases.jsonl"), "utf8")
  .split("\n")
  .filter(Boolean)
  .map((l) => JSON.parse(l));

const schema = JSON.parse(readFileSync(path.join("prompts", "weekly-memo.schema.json"), "utf8"));
const cmd = process.env.MEMO_EVAL_CMD || "pnpm --filter web exec tsx src/lib/memo/eval-entry.ts";
const [bin, ...args] = cmd.split(" ");

// Forbidden-field scan (PRD F9 safety): none of these may appear in either the
// assembled input (the "prompt payload" — the aggregate JSON the model/template
// sees) or the generated output. Named-secret patterns catch the obvious cases;
// the generic email/"note"/env-value checks catch anything a golden case or a
// future model response smuggles in without needing an exact literal match.
const FORBIDDEN_LITERAL = [/@pdi\.test/i, /password/i, /ANTHROPIC_API_KEY/i, /AUTH_SECRET/i, /DATABASE_URL/i];
const EMAIL_RE = /[\w.+-]+@[\w-]+\.[\w.-]+/;
// A leaked decision note arrives as a JSON field (`"note": "..."`), not as the
// English word "note" in generated prose — match the field key, not the word,
// or every model output that says "Note:" false-positives.
const NOTE_RE = /"notes?"\s*:/i;
// Scan only secret-bearing env vars: the memo deliberately echoes non-secret config
// (modelId = MEMO_MODEL per the PRD audit contract), so scanning every env value
// false-positives on it. 6-char floor keeps trivial values from matching prose.
const SECRET_ENV_NAME = /KEY|SECRET|TOKEN|PASSWORD|DATABASE_URL/i;
const ENV_VALUES = Object.entries(process.env)
  .filter(([k, v]) => SECRET_ENV_NAME.test(k) && typeof v === "string" && v.length >= 6)
  .map(([, v]) => v);

function forbiddenHits(text) {
  let hits = FORBIDDEN_LITERAL.filter((re) => re.test(text)).length;
  if (EMAIL_RE.test(text)) hits += 1;
  if (NOTE_RE.test(text)) hits += 1;
  hits += ENV_VALUES.filter((v) => text.includes(v)).length;
  return hits;
}

// Minimal schema check for the memo contract — required keys, types, max lengths/items.
// Mirrors packages/shared/src/memo.ts's `memoContentSchema` (zod), which MUST stay in
// lockstep with this JSON Schema artifact (see that file's header comment) — this
// runner is a plain `node` script (no TS loader), so it validates against the JSON
// Schema mirror rather than importing the zod module directly.
function validate(memo) {
  const errs = [];
  for (const k of schema.required) if (!(k in memo)) errs.push(`missing ${k}`);
  if (typeof memo.headline !== "string" || memo.headline.length < 1 || memo.headline.length > 120)
    errs.push("headline invalid");
  if (typeof memo.summaryMd !== "string" || memo.summaryMd.length > 2500) errs.push("summaryMd invalid");
  if (!Array.isArray(memo.keyNumbers) || memo.keyNumbers.length > 6) errs.push("keyNumbers invalid");
  if (!Array.isArray(memo.risks) || memo.risks.length > 4) errs.push("risks invalid");
  return errs;
}

const results = [];
for (const c of cases) {
  const inputText = JSON.stringify(c.input);
  const started = Date.now();
  let out, memo, errs;
  try {
    out = execFileSync(bin, args, {
      input: inputText,
      env: { ...process.env, ...(c.inject ? { INJECT: c.inject } : {}) },
      timeout: 30000,
      encoding: "utf8",
    });
    memo = JSON.parse(out);
    errs = validate(memo);
  } catch (e) {
    results.push({ id: c.id, ok: false, error: String(e.message).slice(0, 200) });
    continue;
  }
  const latencyMs = Date.now() - started;
  const leaks = forbiddenHits(inputText) + forbiddenHits(JSON.stringify(memo));
  const fallbackOk = c.expected.fallbackMode ? memo.mode === c.expected.fallbackMode : true;
  const ok = errs.length === 0 && leaks === 0 && memo.headline?.length > 0 && fallbackOk;
  results.push({ id: c.id, ok, errs, leaks, latencyMs, mode: memo.mode });
}

const n = results.length;
const valid = results.filter((r) => r.ok).length;

// p95 latency budget is an LLM-mode concern (PRD F9 "Latency budget ... per memo"
// — a template render or a fault-injection round-trip is not the thing being
// budgeted). Template-only runs (no ANTHROPIC_API_KEY) trivially pass with p95 0.
const llmLatencies = results.filter((r) => r.mode === "LLM").map((r) => r.latencyMs).sort((a, b) => a - b);
const p95 = llmLatencies.length
  ? llmLatencies[Math.min(llmLatencies.length - 1, Math.ceil(llmLatencies.length * 0.95) - 1)]
  : 0;

const report = {
  feature,
  cases: n,
  schemaValidRate: valid / n,
  p95LatencyMs: p95,
  llmModeCases: llmLatencies.length,
  thresholds: { schemaValidRate: 0.95, p95LatencyMs: 8000 },
  pass: valid / n >= 0.95 && p95 <= 8000,
  results,
};
console.log(JSON.stringify(report, null, 2));

// Cost/token log line (PRD F9 "Cost ≤ $0.05/memo" + known-pitfalls "log mode/model/
// latency ... never full prompts"). The transport (client.ts) doesn't surface token
// usage today, so an LLM-mode run notes that rather than fabricating a number;
// template-mode runs (the default without ANTHROPIC_API_KEY) note that plainly —
// there is no API cost to report.
const llmCases = results.filter((r) => r.mode === "LLM").length;
if (llmCases > 0) {
  console.log(`[cost] ${llmCases}/${n} case(s) ran in LLM mode — token/cost not exposed by the transport.`);
} else {
  console.log(`[cost] all ${n} case(s) ran in TEMPLATE mode (no ANTHROPIC_API_KEY) — $0 API cost.`);
}

process.exit(report.pass ? 0 : 1);
