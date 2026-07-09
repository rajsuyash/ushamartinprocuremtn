# PDI — Procurement Decision Intelligence

Web platform turning purchasing/consumption history + market prices into weekly demand forecasts, P10/P50/P90 price bands, and one of five recommended buying plays — auditable reasoning, mandatory human approval. The system recommends; humans decide.

## Stack

| Layer | Choice | Notes |
|-------|--------|-------|
| Web | Next.js (App Router) + TypeScript | verify versions against lockfile, not memory |
| UI | Tailwind CSS + shadcn/ui + Recharts | charts client-side only (`dynamic`, `ssr:false`) |
| Auth | Auth.js (NextAuth v5) credentials, JWT session | roles: viewer/buyer/approver/admin, server-side checks |
| Web ORM | Drizzle ORM + drizzle-kit | DB `snake_case` ↔ API `camelCase` |
| Database | PostgreSQL 16 | **LOCKED** (PRD §4) |
| Engine | Python 3.12 + FastAPI + pydantic v2 | internal-only; web is the sole client |
| ML/opt | pandas, LightGBM, statsmodels, OR-Tools, numpy | deterministic: fixed seed, single-thread |
| Package managers | pnpm (web) · uv (engine) | |
| Testing | Vitest + Playwright (web) · pytest (engine) | |
| Orchestration | Docker Compose (postgres + engine + web) | |

Stack decisions marked LOCKED in `docs/PRD.md` §4 are final — do not re-litigate. DELEGATED decisions are yours within their stated constraints; record each pick in PRD Appendix B.

## Commands

```
docker compose up            # full stack: postgres + engine + web
pnpm dev                     # web dev server → always pipe: pnpm dev 2>&1 | tee .claude/dev-server.log
pnpm build                   # production build (web)
pnpm typecheck               # tsc --noEmit across workspace
pnpm lint                    # eslint across workspace
pnpm test                    # vitest (web + shared)
pnpm seed                    # idempotent demo seed, RNG seed 42 — PRD §10 (safe before every suite)
cd services/engine && uv run pytest        # engine tests
node evals/run.mjs memo      # F9 memo golden-set evals
```

These are the target commands (greenfield — M0 creates them). If a script is missing, creating it is part of M0, not a reason to substitute.

## Folder layout (target)

```
apps/web/            # Next.js — surface: web → /verify (browser) + /verify-api (route handlers)
services/engine/     # FastAPI + ML — surface: backend → /verify-api + pytest
packages/shared/     # shared types/contracts (envelope, enums, zod schemas)
prompts/             # F9 prompt artifacts — surface: AI → /evals
evals/memo/          # F9 golden sets + runner — surface: AI → /evals
docs/                # PRD (source of truth), architecture, conventions, test-strategy, pitfalls
fixtures/            # FIX-5 bad_consumption.csv etc. (PRD §10)
```

## Working with the PRD (source of truth)

- `docs/PRD.md` §0 is the agent contract — its rules bind every session. Read §1, §3, §4, §5, then ONLY the feature specs for the current milestone.
- **Milestones:** work one milestone at a time (PRD §5, M0→M7). Current milestone = first with unmet exit criteria. `/plan` derives the task list. Never pull work from later milestones.
- **Markers:** `TODO:` → stop and ask the human (three live in §14). `ASSUMPTION` → proceed, restate it in your summary. Never build anything in §3 non-goals (no SAP connectivity, no PO write-back, no chat copilot, no live feeds, no hedging execution, no multi-tenant, no deep-learning forecasters, no email/SMS delivery, no mobile).
- **Complexity tags:** F1, F2, F5, F6 are `complexity: high` (auth boundary, money data, MILP purchase decisions, immutable audit) — plan first, smallest diffs, `/review` mandatory before done. F3/F4/F7/F8/F9 are medium.
- **Divergence:** if reality contradicts the PRD (untestable AC, conflicting route), do not silently drift — propose a PRD edit, log it in Appendix B, then proceed.

## Non-negotiable rules

- Every web API response uses the envelope `{ success, data, error: { code: "SCREAMING_SNAKE", message } | null }`.
- Role and user identity derive from the server session — never from request body or client-supplied IDs.
- Engine endpoints are internal-only; the web app enforces auth before proxying. Never expose the engine publicly.
- Money = integer INR (no floats); quantities `numeric(12,3)` MT; business dates as `DATE` — no timezone arithmetic.
- Every analytical row (forecasts, bands, recommendations, alerts) carries its `run_id`; nothing analytical is overwritten in place. `DecisionRecord` is append-only, decide-once (`UNIQUE(recommendation_id)`).
- Prompts live in files under `prompts/`, never in string literals. Aggregates only into the model — never user emails, notes, contract terms, or env values.
- Secrets: env vars only (names in PRD §9, values in `.env` — never committed, never logged, never pasted into any doc or commit).
- Fail fast on missing required env vars with a named error — no silent fallbacks.

## Definition of done

A task is NOT complete until ALL of these are true. Do not claim "done" without pasting the evidence.

For ANY change:
1. ✅ `pnpm typecheck` exits 0
2. ✅ `pnpm lint` exits 0
3. ✅ Relevant tests pass (`pnpm test` and/or `uv run pytest`)
4. ✅ One-line summary of WHAT changed and WHY, referencing the AC IDs it satisfies (e.g. F1-AC2)

For changes affecting runtime web behavior (UI, API handlers, browser-rendered pages):
5. ✅ Ran `/verify` on every affected route (auth'd routes use the FIX-1 test users, PRD §10)
6. ✅ Console errors on those routes: zero
7. ✅ Network: zero unexpected 4xx/5xx
8. ✅ Screenshot path attached

For changes to API handlers or engine service code:
5. ✅ `/verify-api` passes — integration tests green for affected endpoints
6. ✅ Response shapes match the PRD data contracts; error paths return the documented envelope
7. ✅ Endpoints touched are listed with their tested statuses

For changes touching prompts, model calls, or eval sets (`prompts/`, `evals/`, memo client code):
5. ✅ Ran `/evals memo` — PRD F9 thresholds met (schema-validity ≥ 95%, zero forbidden-field leakage, p95 ≤ 8s)
6. ✅ Fallback chain exercised (timeout + invalid-JSON injection cases pass; template memo renders)
7. ✅ No exact-text assertions added; no eval case edited just to make a failure pass
8. ✅ Token/cost log line included for the eval run

## Evidence template (paste in your "done" message)

```
DONE: <task> → satisfies <AC IDs>
typecheck ✅ lint ✅ tests ✅ (<n> passed)
<surface evidence: /verify output + screenshot | /verify-api table | /evals scores>
Assumptions surfaced: <none | list>
```

## Deeper docs

- @docs/PRD.md — requirements, milestones, ACs (source of truth)
- @docs/architecture.md — system shape, data flow
- @docs/conventions.md — code style, patterns for this stack
- @docs/test-strategy.md — which layer owns which AC verify-tag
- @docs/known-pitfalls.md — read BEFORE writing code; append when you hit a new one
