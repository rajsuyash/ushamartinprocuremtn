# Test strategy

**Rule: an AC is verified at its tagged layer only.** Passing unit tests never satisfies a `browser-verify` AC. Evidence from the tagged layer is the definition of done (PRD §0.5).

**Fixture dependency:** browser and integration layers assume `pnpm seed` has run (idempotent, RNG 42 — safe before every suite). Browser layer signs in as FIX-1 users (`buyer@pdi.test` etc., PRD §10).

## Verify-tag → owner

| Tag | Owner | How |
|-----|-------|-----|
| `unit` | Vitest (`pnpm test`) for web/shared · pytest (`uv run pytest`) for engine | pure logic: date-matrix parsing (F2-AC4), leakage guard (F3-ERR2), quantile repair (F4-ERR2), MILP solution checks (F5-AC2), determinism (F3-AC3, F4-AC3), solver timeout (F5-ERR3) |
| `integration` | pytest against engine + Vitest/supertest-style route tests + `/verify-api` live smoke | API contracts, envelopes, RBAC 401/403 (F1-AC3, F1-ERR2/3), ingest paths (F2-AC2/3, F2-ERR1/4), run pipeline (F3-AC1, F4-AC1, F5-AC1/3, F5-ERR1/2), alerts (F7-ERR1/2), actualization (F8-AC2, F8-ERR2), memo fallbacks (F9-ERR1/2) |
| `browser-verify` | browser-verifier subagent via `/verify` (Playwright MCP, dev server :3000) | SKEL-AC1, F1-AC1/AC2/ERR1, F2-AC1/ERR2/ERR3, F3-AC2, F4-AC2, F6 all, F7-AC1/AC2, F8-AC1/ERR1, F9-AC1 — verdict table + screenshots in `.claude/verify-artifacts/` |
| `evals` | eval-runner subagent via `/evals memo` (`node evals/run.mjs memo`) | F9-AC2: schema-validity ≥ 95%, zero forbidden-field leakage, headline non-empty, p95 ≤ 8s. Golden sets in `evals/memo/` are fixtures — never edited to pass |
| `manual` | none tagged in this PRD | — |

## Per-milestone gate

Milestone exit = every named AC green at its tagged layer (PRD §5). M5 additionally re-runs the full P0 suite; M7 the full P0+P1 suite. `/plan` restates the current milestone's AC list; `/ship` blocks on stale or missing evidence.

## Determinism policy

Same seed + same data ⇒ identical outputs (F3-AC3, F4-AC3, F5-AC1). Any flake here is a bug in seeding/threading config, not "ML being ML" — fix the config, never widen the assertion.
