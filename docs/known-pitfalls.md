# Known pitfalls

Read BEFORE writing code. Append (symptom → cause → fix) when you hit a new one. Reintroducing a listed pitfall = automatic CRITICAL in `/review`.

## Base

- Secrets in logs/commits → grep habit; `.env` gitignored + deny-read in `.claude/settings.json`; env var names only in docs.
- Double-submit / race on writes → disable button on first click AND server-side uniqueness (`UNIQUE(recommendation_id)`, `idempotency_key`).
- N+1 queries → batch/join; supplier-share denominator computed once in SQL, tested (F5 pitfall).
- List endpoints without pagination → default limit; `/api/recommendations`, `/api/alerts` filterable.
- Time zones → business dates are `DATE`; never let JS `Date` shift them. Store UTC only for timestamps.

## Next.js / React (apps/web)

- Hydration mismatch: `Date.now()`, `Math.random()`, locale-formatted numbers in first render → server props or client-only render. **Recharts must be `dynamic(..., { ssr: false })`** (PRD F6 pitfall).
- Missing `"use client"` on files using hooks/handlers/browser APIs → cryptic build error.
- Auth middleware matcher must exclude `/api/auth/*` and static assets, or login loops (PRD F1 pitfall).
- Server Components can't pass functions/class instances as props to client components.
- `NEXT_PUBLIC_` exposes to the client — nothing sensitive ever.
- shadcn semantic tokens, not raw colors.
- Disable login button after first submit — double POST (PRD F1 pitfall).

## FastAPI / Python (services/engine)

- Sync work in async handlers blocks the loop → threadpool for ML/solver.
- pydantic v1 vs v2 syntax mixing → v2 only (`model_validate`, `Field`).
- Forgotten `await` → coroutine never runs, silent.
- Mutable default args (`def f(x=[])`) → shared state bugs.

## Backend / API

- Client-supplied IDs or roles trusted → authz bug class #1; session-derived only.
- Error responses leaking stack traces instead of the documented envelope.
- Missing idempotency on retried mutations → decision POST retry-safe via `idempotency_key` (F6-ERR3).
- Engine down must fail fast: `ENGINE_UNAVAILABLE` run failure with retry, no hang (F2-ERR4).

## Data ingestion (F2)

- UTF-8 BOM and thousands separators (`54,200`) break numeric parse → strip before parse; reject `₹` with row error, never silent NaN.
- XLSX dates are serial numbers → convert explicitly; ambiguous `MM-DD` vs `DD-MM` resolved as `DD-MM`, documented on template.
- Duplicate PO key: `(po_number, material_code, delivery_date)`; market price key: `(date, source, grade_family)`.
- Never load a 50k-row file into memory as objects → stream/chunk parse.

## Analytics (F3/F4/F5)

- Rolling-origin backtest must re-fit per fold — single fit scored on holdout inflates confidence (leakage-adjacent).
- Never leak future prices into lag features at fold boundaries; `LEAKAGE_GUARD` fails the series loudly.
- LightGBM: `deterministic=true`, `num_threads=1`, fixed seed — or F3-AC3/F4-AC3/F5-AC1 flake.
- ISO weeks, Monday start, consistent engine + UI.
- Coverage is the honesty metric — display even when unflattering; never clamp or hide.
- Cover must include open POs by delivery week, not just on-hand stock.
- Seed the Monte Carlo path generator or `expectedImpact` flakes tests.
- `HEDGE_LOCK` = memo only — order lines must be empty for it.

## Decisions & reporting (F6/F8)

- Render rationale from the **stored** JSON — never recompute client-side, or the audit view drifts from what was decided on.
- Never mutate a decision's stored inputs when actualizing — add fields, keep the original estimate visible.
- Indian number grouping → `Intl.NumberFormat('en-IN')`, not manual regex.

## AI (F9)

- Exact-text assertions on generative output → flaky forever; assert schema/fields/thresholds only.
- Editing a golden case to make a failing eval pass → eval fraud; thresholds change only via human PRD edit.
- Any `prompts/` diff ⇒ `/evals memo` before done.
- Unbounded retries → cost blowup; retry cap 1 + 10s timeout, then template fallback.
- Model output used without schema validation → validate → fallback, never crash.
- Forbidden fields (emails, notes, contract terms, env values) in the prompt → scrub at the assembly boundary; string-scan in evals.

## Local infra (this machine — discovered M0)

- Docker builds fail "docker-credential-desktop not found" → non-login shell PATH → prefix `/Applications/Docker.app/Contents/Resources/bin`.
- Host ports 8000/5432/5433/6379/9000 are owned by other projects (aisewak, athena, sentinel) → PDI uses engine 8100, postgres 5442 (loopback, via `ENGINE_HOST_PORT`/`POSTGRES_HOST_PORT` in .env).
- Python src-layout + uv: without `[build-system]` (hatchling), `uv sync` never installs the package — imports work locally only via conftest sys.path hack, then crash in Docker.
- Subagent verification can pass on env vars exported in its own shell — main session re-verifies on a clean env before commit.
- Runtime `pnpm start` in Docker = corepack fetches pnpm from the network at container start; newer corepack prompts → container exits 0 silently. Run `node_modules/.bin/next start` directly in the runtime stage.
