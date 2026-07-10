# F9 memo evals

Golden set for the weekly memo (PRD §6 F9, FIX-4). 10 cases, `input` shaped exactly
like `WeekAggregate` (`apps/web/src/lib/memo/aggregate.ts`) — normal week, zero
decisions, all-rejected, high alerts, zero runs, negative value, zero alerts, a
mixed week, plus the two fault-injection cases.

## Run

```bash
node evals/run.mjs memo
```

Uses the memo generator entrypoint `apps/web/src/lib/memo/eval-entry.ts` (T34):
`MEMO_EVAL_CMD` env, default `pnpm --filter web exec tsx src/lib/memo/eval-entry.ts`
— reads one case `input` JSON on stdin, writes the memo JSON (with `mode`) on
stdout. `"inject"` cases are passed as `INJECT=timeout|invalid-json` env, which
forces the LLM path through a fake failing transport to exercise the real
retry → template fallback chain — independent of whether `ANTHROPIC_API_KEY` is set.

**Without `ANTHROPIC_API_KEY`**, every non-inject case runs in `TEMPLATE` mode (same
env-gated `generateMemo` used in production) — schema-validity, headline, and
forbidden-field checks still run for real; only the LLM-mode p95-latency and
token/cost figures require a live key to be meaningful.

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
