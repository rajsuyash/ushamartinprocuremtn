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

// Forbidden-field scan (PRD F9 safety): none of these may appear in memo output.
const FORBIDDEN = [/@pdi\.test/i, /password/i, /ANTHROPIC_API_KEY/i, /AUTH_SECRET/i, /DATABASE_URL/i];

// Minimal schema check for the memo contract — required keys, types, max lengths/items.
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
  const started = Date.now();
  let out, memo, errs;
  try {
    out = execFileSync(bin, args, {
      input: JSON.stringify(c.input),
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
  const text = JSON.stringify(memo);
  const leaks = FORBIDDEN.filter((re) => re.test(text)).length;
  const fallbackOk = c.expected.fallbackMode ? memo.mode === c.expected.fallbackMode : true;
  const ok = errs.length === 0 && leaks === 0 && memo.headline?.length > 0 && fallbackOk;
  results.push({ id: c.id, ok, errs, leaks, latencyMs, mode: memo.mode });
}

const n = results.length;
const valid = results.filter((r) => r.ok).length;
const latencies = results.map((r) => r.latencyMs ?? 0).sort((a, b) => a - b);
const p95 = latencies[Math.min(n - 1, Math.ceil(n * 0.95) - 1)] ?? 0;
const report = {
  feature,
  cases: n,
  schemaValidRate: valid / n,
  p95LatencyMs: p95,
  thresholds: { schemaValidRate: 0.95, p95LatencyMs: 8000 },
  pass: valid / n >= 0.95 && p95 <= 8000,
  results,
};
console.log(JSON.stringify(report, null, 2));
process.exit(report.pass ? 0 : 1);
