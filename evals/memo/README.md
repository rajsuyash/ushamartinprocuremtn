# F9 memo evals

Golden set for the weekly memo (PRD §6 F9, FIX-4). Cases marked `"starter": true` are scaffold-generated — expand to the full 10-case FIX-4 set before trusting scores.

## Run

```bash
node evals/run.mjs memo
```

Requires the memo generator entrypoint (built in M7): `MEMO_EVAL_CMD` env, default `pnpm --filter web exec tsx src/lib/memo/eval-entry.ts` — reads one case `input` JSON on stdin, writes the memo JSON (with `mode`) on stdout. `"inject"` cases are passed as `INJECT=timeout|invalid-json` env to exercise the fallback chain.

## Thresholds (from PRD F9 — change only via human PRD edit)

| Metric | Threshold |
|--------|-----------|
| Schema-validity rate | ≥ 95% |
| Headline non-empty | 100% |
| Forbidden-field leakage (emails, decision notes, contract terms, env values — string scan) | 0 occurrences |
| p95 latency | ≤ 8s |
| Cost per memo | ≤ $0.05 |
| Fault-injection cases | fallback fires: 1 retry → template memo, `mode:"TEMPLATE"` |

## Rules

- Never edit a case or threshold to make a run pass (eval fraud — see docs/known-pitfalls.md).
- Never assert exact generative text; schema/fields/thresholds only.
