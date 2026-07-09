# Conventions

Stack-specific rules for this repo. PRD §4 constraints win any conflict.

## Next.js (apps/web)

- **Server Components by default.** `"use client"` only for interactivity: charts, upload drop, decision bar, polling status pills.
- **Charts:** Recharts, always `dynamic(() => import(...), { ssr: false })` — hydration mismatch otherwise (known pitfall F6).
- **Route Handlers, not Server Actions,** for everything under `/api/*` — the PRD documents exact method/status contracts per route; handlers keep them testable via `/verify-api`.
- **Envelope everywhere:** `{ success, data, error: { code, message } | null }`. Error codes SCREAMING_SNAKE from the PRD tables. Never leak stack traces.
- **Validation at boundary:** zod schema per route input, defined in `packages/shared`, parsed before any logic. 400 with named code on failure.
- **Casing:** DB `snake_case` (Drizzle schema) ↔ API/TS `camelCase`. Mapping lives in the Drizzle schema definitions only — no ad-hoc renaming elsewhere.
- **Styling:** Tailwind + shadcn semantic tokens (`bg-background`, `text-muted-foreground`), never raw colors. `data-testid` / `data-action` attributes from PRD §6 are contractual — never rename.
- **Money display:** `Intl.NumberFormat('en-IN')` for lakh/crore grouping. Store integer INR, format at display only.

## FastAPI (services/engine)

- pydantic v2 models for every request/response; `POST /v1/*` bodies validated at boundary.
- Async handlers; heavy ML work runs in threadpool (`run_in_executor`) — never block the event loop.
- Error taxonomy: named codes (`INSUFFICIENT_HISTORY`, `LEAKAGE_GUARD`, `SOLVER_TIMEOUT`, `NO_FEASIBLE_PLAN`, …) in run warnings jsonb — the run continues per-series where the PRD says so; it never crashes the whole run for one series.
- Determinism is contractual: LightGBM `deterministic=true`, `num_threads=1`, fixed seed; Monte Carlo seeded; ISO weeks Monday-start everywhere.
- No auth in the engine; it is network-internal. No public exposure ever.

## AI (F9 memo)

- Prompts in `prompts/weekly-memo.md` + `prompts/weekly-memo.schema.json` — never string literals.
- One model-client module; timeout 10s, retry cap 1, then deterministic template fallback. Never an error dead-end.
- Every model output zod-validated against the schema before render/store. Invalid ⇒ fallback path.
- Input = aggregates only. Forbidden: user emails, decision notes, supplier contract terms, env values.
- Log mode/model/latency per call; never full prompts with data in production logs.

## Naming & layout

- Files: kebab-case; components PascalCase; hooks `use*`.
- Tests colocated: `*.test.ts` next to source (web), `tests/` mirror (engine).
- Imports: std/external/internal groups, no deep relative chains — use workspace aliases.
- Fixtures under `fixtures/` (FIX-5 etc.), seed code under `seed/` — both deterministic, RNG seed 42.
