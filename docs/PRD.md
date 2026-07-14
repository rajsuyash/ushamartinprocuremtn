# PDI — Procurement Decision Intelligence · Product Requirements

**Status:** Draft v1 · **Last updated:** 2026-07-07 · **Format:** agent-optimized PRD v3

<!--
Conventions used throughout:
- TODO: <text>             → requires a product decision from a human; the agent must NOT resolve it
- ASSUMPTION(conf): <text> → best inference, confidence high/med/low; agent may build on it but must surface it
- LOCKED                   → decision made by the human; do not revisit
- DELEGATED                → decision left to the agent, within the stated constraints
- P0 must ship in v1 · P1 nice-to-have · P2 backlog
- Verify tags on every AC: unit | integration | browser-verify (/verify via browser-verifier subagent) | manual
- IDs are globally unique: F1, F1-AC1, F1-ERR1, E1, M0, ENV-1, FIX-1 — reference them in commits, branches, tests
-->

---

## 0. How to use this document (for the coding agent)

**Read order:** §1 Summary → §3 Scope → §4 Stack & decisions → §5 Build sequence → then ONLY the feature specs for the milestone you are working on. Do not preload every feature into context; each spec is self-contained.

**Rules of engagement:**

1. **The current milestone defines your scope.** Build to its exit criteria (named AC IDs). Do not start work from later milestones, and never build anything in §3's non-goals — even if it seems helpful.
2. **Markers are binding.** `TODO:` = stop and ask the human; never pick an answer. `ASSUMPTION` = proceed, but restate it in your task summary. `LOCKED` decisions are final. `DELEGATED` decisions are yours — choose the simplest option that satisfies the constraints, and record your choice in the changelog (Appendix B).
3. **Verify stack versions against the lockfile, not memory.** Framework APIs drift; when uncertain about current syntax, resolve against installed versions and current docs (use your docs tool, e.g. Context7) before writing code.
4. **Simplicity bias.** Boring technology, smallest diff that passes the AC, no speculative abstraction, no features "for later". If an AC passes, the task is done.
5. **Definition of done = evidence.** A task is complete when its named ACs pass at their tagged verification layer (`/verify` output, test run, etc.) — not when the code "looks right".
6. **This PRD is the source of truth.** If reality diverges (an AC is untestable, a route conflicts, a decision proves wrong), do not silently drift: propose a PRD edit, record it in Appendix B, then proceed.
7. **Never write secret values** into this document, code, commits, or logs. Env var names only (§9).

---

## 1. Summary

**What it is (one sentence):** A web platform that turns a manufacturer's purchasing/consumption history plus market price data into weekly demand forecasts, honest P10/P50/P90 price bands, and one of five recommended buying plays per material — each with auditable reasoning and mandatory human approval.

**Problem:** Industrial buyers of volatile commodities (first deployment: wire rod at a specialty wire-rope maker) decide when, how much, and from whom to buy deal-by-deal, without a consistent forward view — leaking an estimated 1.5–3% of raw-material spend through mistimed buys, unmanaged supplier spreads, oversized safety stock, and emergency purchases.

**Primary user:** Category manager (buyer) responsible for a raw-material category across plants.

**Product type:** Full-stack web app (Next.js frontend + Python analytics engine) · **Browser-facing:** Yes · **Stage:** Greenfield

**Deployment context:** Single-tenant pilot per client. First pilot: one wire-rod grade at one plant, file-based data from SAP exports, no SAP write-back. The system recommends; humans decide.

---

## 2. Users & context

### Primary persona

| Attribute | Value |
|-----------|-------|
| Role | Category manager ("buyer") for wire rod procurement |
| Context | Buys ₹100+ crore/year of a volatile commodity from 2–4 suppliers; lives in SAP + Excel + phone calls |
| Current workflow | Checks stock cover, calls suppliers for offers, buys when cover gets uncomfortable or a deal feels good |
| Cares about | Never causing a stock-out; defensible decisions; not overpaying vs. colleagues/market; minimal new-tool overhead |
| Explicitly does not care about | Model architecture, MLOps, dashboards for their own sake |

### Secondary persona

| Attribute | Value |
|-----------|-------|
| Role | Head of Procurement ("approver") |
| Context | Owns procurement policy and the raw-material P&L line; reports savings to CFO |
| Cares about | Policy compliance (cover floors, supplier caps), audit trail, measured value vs. baseline |

### Key use cases

1. When the weekly recompute runs, the buyer wants to see the recommended play (buy now / wait / partial / hedge memo / split suppliers) with the reasoning, so they can act consistently instead of reactively.
2. When cover for a grade falls toward the policy floor while the price band is rising, the buyer wants an alert plus a quantified buy recommendation, so a forced emergency buy never happens.
3. When the CFO asks "what has this saved us," the approver wants a report of every decision vs. an agreed baseline, so the pilot's go/no-go is a number, not an opinion.

---

## 3. Scope

### In scope for v1

| ID | Feature | Priority | Complexity | Brief description | Verification |
|----|---------|----------|------------|-------------------|--------------|
| F1 | Auth & RBAC | P0 | high — auth boundary gates every route and decision | Credentials login; roles viewer/buyer/approver/admin enforced server-side | mixed |
| F2 | Data ingestion & demo seed | P0 | high — data integrity is the foundation; parsing money data | CSV/XLSX upload of SAP-style exports + market prices; validation; commit; deterministic demo dataset | mixed |
| F3 | Demand forecast engine | P0 | medium — analytics read-path; correctness proven by backtest metrics | Weekly demand forecast per material×plant with rolling-origin backtest (WAPE) | integration + unit |
| F4 | Price band engine | P0 | medium — probabilistic output with coverage backtest, no irreversible ops | P10/P50/P90 price bands at 1w/4w/12w horizons with honest coverage reporting | integration + unit |
| F5 | Play recommendation engine | P0 | high — money-adjacent optimization driving purchase decisions | MILP + Monte Carlo turns bands+demand+policy into one of five plays with quantity, timing, supplier split, reasoning | integration + unit |
| F6 | Buyer's cockpit & decision workflow | P0 | high — records irreversible, auditable purchase decisions | Dashboard, recommendation detail, approve/override/reject with immutable audit trail | browser-verify + integration |
| F7 | Risk alerts | P1 | medium — read-path triggers on committed data | In-app alerts: cover breach, concentration breach, band widening, price spike | mixed |
| F8 | Value tracking & pilot report | P1 | medium — money reporting, read-only | Decision ledger vs. agreed baseline; cumulative value; pilot go/no-go view | mixed |
| F9 | AI weekly memo | P1 | medium — LLM feature, strictly schema-bound, feature-flagged | Claude-generated weekly summary memo from structured run data; deterministic fallback | integration + unit |

**If only one feature ships, it is F5** — everything else exists to feed or expose it.

### Explicitly NOT in scope for v1 (non-goals)

- **No live SAP integration** (no OData, RFC, IDoc, or direct DB access). Ingestion is file-based only; the adapter interface must make a future SAP connector possible without schema changes, but do not build it.
- **No autonomous purchasing and no SAP write-back.** The system never creates, modifies, or transmits a purchase order anywhere. Every recommendation terminates in a human decision recorded in-app.
- **No voice or telephony interface, and no natural-language chat copilot.** This product is dashboard-first. (F9's memo is generated text output, not an interactive copilot.)
- **No live paid market-data feeds** (SteelMint, CRU, Platts, etc.). Market prices arrive via file upload in v1; the price table is source-agnostic so a feed can plug in later.
- **No hedging execution.** The HEDGE_LOCK play outputs a recommendation memo only; no derivatives, no broker integration, no financial instrument booking.
- **No multi-tenant SaaS layer.** One deployment = one client. No org switching, no tenant isolation machinery.
- **No deep-learning forecasters** (no TFT/transformers). Gradient boosting + statistical baselines only in v1 — matched to data volume and auditability needs.
- **No email/SMS/WhatsApp notification delivery.** Alerts are in-app only.
- **No mobile app.** Responsive web only.

### Future considerations (do NOT build)

- SAP OData adapter implementing the same ingestion interface as file upload
- Live market-price feed connector
- Approver countersign step for decisions above a value threshold
- Multi-language UI (Hindi)
- NL query copilot over the decision ledger

---

## 4. Stack & decisions

### Stack

| Layer | Choice | Version | Status |
|-------|--------|---------|--------|
| Monorepo layout | `apps/web` + `services/engine` + `packages/shared` (pnpm workspaces) | — | PROPOSED |
| Frontend | Next.js (App Router) + TypeScript | per lockfile (Next 15.x, TS 5.x) | PROPOSED |
| UI | Tailwind CSS + shadcn/ui + Recharts | per lockfile | PROPOSED |
| Auth | Auth.js (NextAuth v5) credentials provider, JWT session | per lockfile | PROPOSED |
| Web ORM | Drizzle ORM + drizzle-kit migrations | per lockfile | PROPOSED |
| Database | PostgreSQL | 16.x | LOCKED |
| Analytics engine | Python + FastAPI + pydantic v2 | 3.12 / per lockfile | PROPOSED |
| ML / optimization | pandas, LightGBM (quantile + point), statsmodels (ETS), OR-Tools (CP-SAT/MILP), numpy (Monte Carlo) | per lockfile | PROPOSED |
| Package managers | pnpm (web) · uv (engine) | — | PROPOSED |
| Testing | Vitest + Playwright (web) · pytest (engine) | per lockfile | PROPOSED |
| Local orchestration | Docker Compose (postgres + engine + web) | — | PROPOSED |
| Hosting target | Single VPS or client VM via Compose; localhost for demo | — | PROPOSED |

### Delegated decisions (agent's choice, within constraints)

| Decision | Constraint |
|----------|-----------|
| Charting details (Recharts composition) | Must render band charts (shaded P10–P90 region + P50 line) and cover-vs-time; no canvas libs |
| CSV/XLSX parsing library | Must stream or chunk ≥50k rows without OOM; must surface row-level errors |
| Run execution model | Web calls engine synchronously per run with a `Run` state row and polling UI; if a single run exceeds 120s on demo data, propose a queue in Appendix B — do not add one preemptively |
| Folder layout below `apps/web/src` and `services/engine/src` | Follow framework conventions; document in `docs/architecture.md` |
| DB-level enforcement of decision immutability (trigger vs. app-layer only) | App layer must enforce regardless; trigger optional |
| LightGBM hyperparameters | Fixed seed, `deterministic=true`, single-thread for reproducible ACs; tuning beyond defaults only if backtest gates fail |

### Architectural constraints

- All web API responses use the envelope `{ "success": boolean, "data": object|null, "error": { "code": "SCREAMING_SNAKE", "message": string } | null }`.
- Role and user identity always derive from the server session — never from request body or client-supplied IDs.
- Engine endpoints are internal-only (reachable from the web server, not the public internet); the web app is the sole client and enforces auth before proxying.
- All money values stored as integer INR (no floats); quantities as `numeric(12,3)` MT; dates as `DATE` (no timezone arithmetic on business dates).
- Every forecast/recommendation row carries the `run_id` that produced it; nothing analytical is overwritten in place.
- Prompts (F9) live in files under `prompts/`, never in string literals.

---

## 5. Build sequence

| Milestone | Goal | Features touched | Exit criteria (must pass) | Demoable check |
|-----------|------|------------------|---------------------------|----------------|
| **M0 — Walking skeleton** | Compose boots postgres+engine+web; login page renders; engine `/health` returns 200; dev loop + `/verify` proven | — | SKEL-AC1, SKEL-AC2 | `docker compose up` → open `http://localhost:3000/login`, see form; `curl engine /health` |
| **M1 — Auth + data in** | Users can log in by role; demo seed loads; uploads validate and commit | F1, F2 | F1-AC1, F1-AC2, F1-AC3, F1-ERR1, F1-ERR2, F1-ERR3, F2-AC1, F2-AC2, F2-AC3, F2-AC4, F2-ERR1, F2-ERR2, F2-ERR3, F2-ERR4 | Log in as buyer, open `/data`, see seeded dataset status; upload the sample bad CSV, see row errors |
| **M2 — Demand forecasts** | Recompute produces demand forecasts with backtest WAPE | F3 | F3-AC1, F3-AC2, F3-AC3, F3-ERR1, F3-ERR2 | Trigger run on `/data`, open `/forecasts?tab=demand`, see 12-week curve + WAPE badge |
| **M3 — Price bands** | Price band forecasts with coverage backtest | F4 | F4-AC1, F4-AC2, F4-AC3, F4-ERR1, F4-ERR2 | `/forecasts?tab=price` shows shaded P10–P90 band + coverage stat |
| **M4 — Recommendation engine** | Runs emit a play recommendation with reasoning JSON | F5 | F5-AC1, F5-AC2, F5-AC3, F5-ERR1, F5-ERR2, F5-ERR3 | `POST /api/runs` then `GET /api/recommendations` returns a `BUY_NOW` rec on the FIX-3 scenario with populated rationale |
| **M5 — Cockpit & decisions (P0 complete)** | Full buyer flow: dashboard → detail → decide, audited | F6 | F6-AC1, F6-AC2, F6-AC3, F6-ERR1, F6-ERR2, F6-ERR3 **and every P0 AC from F1–F5 green in the same suite** | Login → dashboard tiles → open rec → Approve → status + audit entry visible; re-decide blocked |
| **M6 — Alerts + value** | Risk alerts fire on committed data; decision ledger vs. baseline | F7, F8 | F7-AC1, F7-AC2, F7-ERR1, F7-ERR2, F8-AC1, F8-AC2, F8-ERR1, F8-ERR2 | `/alerts` shows seeded COVER_BREACH; `/reports/pilot` shows cumulative value line |
| **M7 — AI memo (v1 complete)** | Weekly memo generation with fallback; full regression green | F9 | F9-AC1, F9-AC2, F9-ERR1, F9-ERR2, F9-ERR3; full P0+P1 AC suite passes | Click "Generate memo" on `/reports/pilot`, memo renders; with `ANTHROPIC_API_KEY` unset, deterministic fallback memo renders with a notice |

**SKEL-AC1:** Given the stack is up via `docker compose up`, when a browser opens `/login`, then the page returns 200, the login form (`[data-testid="login-form"]`) is visible, and zero console errors are recorded. *Verify: browser-verify.*
**SKEL-AC2:** Given the stack is up, when `GET {ENGINE_URL}/health` is called, then it returns 200 `{ "status": "ok", "db": "connected" }`. *Verify: integration.*

---

## 6. Feature specifications

### F1 · Auth & RBAC — P0 · complexity: high

**User story:** As any user, I want to log in with my email and password and only see/do what my role permits, so decisions and data are protected and attributable.

**Description:** Credentials auth via Auth.js. Four roles. All app routes except `/login` require a session; role checks happen server-side (middleware + per-action) — UI hiding alone is insufficient.

**Role matrix (authoritative):**

| Capability | viewer | buyer | approver | admin |
|---|---|---|---|---|
| View dashboards, forecasts, recs, alerts, reports | ✓ | ✓ | ✓ | ✓ |
| Upload data, trigger runs | | ✓ | ✓ | ✓ |
| Decide recommendations (approve/override/reject) | | ✓ | ✓ | ✓ |
| Edit policy (`/settings/policy`) | | | ✓ | ✓ |
| Manage users | | | | ✓ |

**Routes & network:**

| Route | Method | Purpose | Expected status |
|-------|--------|---------|-----------------|
| `/login` | GET | Login page | 200 |
| `/api/auth/*` | GET/POST | Auth.js handlers (sign-in, session, sign-out) | 200 / 302 / 401 |
| `/` | GET | Dashboard (protected) | 200 auth'd; 302 → `/login` otherwise |
| `/settings/policy` | GET | Policy page (approver/admin) | 200 permitted; 302 → `/` with toast otherwise |
| `/api/*` (all except `/api/auth/*`) | any | Protected resource pattern — session required | 401 `UNAUTHENTICATED` without session |

**Happy path:**
1. User opens `/login`, submits `[data-testid="login-form"]` with a FIX-1 credential; Auth.js responds, session cookie set, redirect to `/`.
2. Dashboard renders with the user's name and role chip (`[data-testid="role-chip"]`).
3. Sign-out from the user menu clears the session and returns to `/login`.

**Data in:** `{ "email": "buyer@pdi.test", "password": "<fixture>" }`
**Data out / side effects:** JWT session cookie; `User.last_login_at` updated.

**Acceptance criteria:**

| ID | Given | When | Then | Verify |
|----|-------|------|------|--------|
| F1-AC1 | Seeded FIX-1 users; browser on `/login` | buyer submits valid credentials | 302 to `/`; dashboard renders; `[data-testid="role-chip"]` shows "buyer"; zero console errors | browser-verify |
| F1-AC2 | Authenticated viewer session | viewer opens `/settings/policy` | Server redirects (302) to `/` and shows toast "Not permitted"; no policy data in the response payload | browser-verify |
| F1-AC3 | No session | request `GET /api/recommendations` | 401 envelope `{ success:false, error:{ code:"UNAUTHENTICATED" } }` | integration |

**Error cases:**

| ID | Case | Expected behavior | Verify |
|----|------|-------------------|--------|
| F1-ERR1 | Wrong password | Form shows inline "Invalid email or password"; no session cookie; stays on `/login`; attempt logged | browser-verify |
| F1-ERR2 | Viewer POSTs a decision to `/api/recommendations/:id/decision` | 403 `{ code:"FORBIDDEN_ROLE" }`; no DecisionRecord created | integration |
| F1-ERR3 | Session cookie tampered/expired | Any protected route → 302 `/login`; API → 401 `UNAUTHENTICATED` | integration |

**Known pitfalls to anticipate:**
- Middleware matcher must exclude `/api/auth/*` and static assets, or login loops.
- Every mutating API route re-derives role from session server-side; never trust a role field from the client.
- Disable the login button after first submit to prevent double POST.

**Dependencies:** none.
**Out of scope for this feature:** SSO/OAuth, password reset flows (admin resets via seed/script in v1), MFA.

---

### F2 · Data ingestion & demo seed — P0 · complexity: high

**User story:** As a buyer, I want to upload SAP-style export files and market prices, get row-level validation, and commit clean data, so every downstream number traces to source data.

**Description:** Four file types with fixed, documented headers (templates downloadable in-app from `/data`): `purchase_orders`, `consumption`, `market_prices`, `inventory`. Upload → parse → validate → staged batch with per-row errors → commit. A deterministic demo seed (`pnpm seed`, RNG seed 42) creates 36 months of realistic history for 2 plants × 3 grades × 3 suppliers so the product demos without client data.

**File contracts (exact headers, CSV or XLSX first sheet):**

| Type | Required columns |
|------|------------------|
| purchase_orders | `po_number, po_date, supplier_code, material_code, plant_code, qty_mt, unit_price_inr, delivery_date` |
| consumption | `date, material_code, plant_code, qty_mt` |
| market_prices | `date, source, grade_family, price_inr_mt` |
| inventory | `as_of_date, material_code, plant_code, qty_mt` |

**Routes & network:**

| Route | Method | Purpose | Expected status |
|-------|--------|---------|-----------------|
| `/data` | GET | Dataset status, templates, upload UI, run trigger | 200 |
| `/api/uploads` | POST (multipart) | Create batch: parse + validate | 201 (staged) / 400 / 401 / 413 |
| `/api/uploads/:id` | GET | Batch status + row errors | 200 / 404 |
| `/api/uploads/:id/commit` | POST | Commit staged rows | 200 / 409 (already committed / has blocking errors) |
| `/api/runs` | POST | Trigger recompute (forecasts + recs + alerts) | 202 |
| `/api/runs/:id` | GET | Run status | 200 |

**Happy path:**
1. Buyer on `/data` selects type `consumption`, drops a valid CSV on `[data-testid="upload-drop"]`; `POST /api/uploads` returns 201 with `{ batchId, rows, errors: [] }`.
2. Buyer clicks `[data-action="commit-batch"]`; 200; dataset status card increments committed row counts.
3. Buyer clicks `[data-action="trigger-run"]`; `POST /api/runs` 202; status pill polls `/api/runs/:id` until `DONE`.

**Data in (upload response example):**
```json
{ "batchId": "b_01H...", "type": "consumption", "rows": 1560, "validRows": 1560, "errors": [] }
```
**Data out / side effects:** staged rows → committed rows on commit; `UploadBatch.status` transitions `STAGED → COMMITTED`.

**Acceptance criteria:**

| ID | Given | When | Then | Verify |
|----|-------|------|------|--------|
| F2-AC1 | Logged-in buyer on `/data`; FIX-2 seeded | uploads a valid 50-row consumption CSV and commits | 201 then 200; status card `[data-testid="dataset-status"]` shows updated committed count; zero console errors | browser-verify |
| F2-AC2 | Valid `market_prices` file with a duplicate `(date, source, grade_family)` row already committed | upload + commit | Duplicate rows skipped idempotently; response reports `{ skippedDuplicates: n }`; no double rows in DB | integration |
| F2-AC3 | Committed FIX-2 data | `POST /api/runs` then poll | Run reaches `DONE` in <120s; run row records counts of forecasts + recommendations produced | integration |
| F2-AC4 | Any parsed file | dates in `DD-MM-YYYY`, `YYYY-MM-DD`, and Excel serial formats | All parse to the same `DATE` values (unit-tested matrix); ambiguous `MM-DD` vs `DD-MM` resolved as `DD-MM` and documented on the template | unit |

**Error cases:**

| ID | Case | Expected behavior | Verify |
|----|------|-------------------|--------|
| F2-ERR1 | Missing required column | 400 `{ code:"MISSING_COLUMN", detail:{ column } }`; nothing staged | integration |
| F2-ERR2 | FIX-5 malformed rows (negative qty, bad date, unknown plant_code) | 201 staged with `errors[]` listing row number + code per row (`NEGATIVE_QTY`, `INVALID_DATE`, `UNKNOWN_PLANT`); commit returns 409 `BLOCKING_ROW_ERRORS` until rows are excluded via `[data-action="commit-valid-only"]` | browser-verify |
| F2-ERR3 | File >20 MB | 413 `{ code:"FILE_TOO_LARGE" }`; UI inline error, no spinner hang | browser-verify |
| F2-ERR4 | Engine down when run triggered | Run row `FAILED` with `{ code:"ENGINE_UNAVAILABLE" }`; `/data` shows failed pill with retry button; retry-safe | integration |

**Known pitfalls to anticipate:**
- Strip UTF-8 BOM and thousands separators (`54,200`) before numeric parse; reject `₹` symbols with a clear row error rather than silent NaN.
- XLSX dates arrive as serial numbers — convert explicitly; never let the JS `Date` timezone shift a business date.
- Duplicate PO line detection key: `(po_number, material_code, delivery_date)`.
- Stream-parse; never load a whole 50k-row file into memory as objects at once.

**Dependencies:** F1 (auth).
**Out of scope for this feature:** any live SAP connectivity; scheduled/automatic runs (manual trigger only in v1).

---

### F3 · Demand forecast engine — P0 · complexity: medium

**User story:** As a buyer, I want a 12-week demand forecast per material×plant with its backtest error shown, so I trust the denominator behind every recommendation.

**Description:** Engine service. Weekly bucketing of committed consumption. Three candidate models per series — seasonal-naive (baseline), ETS, LightGBM point — evaluated by rolling-origin backtest (last 26 weeks, weekly re-fit). The lowest-WAPE model wins per series; the winner and its WAPE are persisted with the run and displayed. Missing weeks are treated as true zeros only when the plant was active (plant has any movement that month); otherwise excluded.

**Engine endpoint (internal):** `POST /v1/forecast/demand` `{ run_id }` → 200 `{ series: n, forecasts: n×12 }` / 422 / 500.

**Data out (per series, stored as E10 rows):**
```json
{ "runId": "r_01H...", "materialCode": "WR-5.5-HC", "plantCode": "RNC", "week": "2026-07-13", "p50QtyMt": 412.500, "model": "lightgbm", "backtestWape": 0.135 }
```

**Acceptance criteria:**

| ID | Given | When | Then | Verify |
|----|-------|------|------|--------|
| F3-AC1 | FIX-2 committed | demand forecast runs | Every active material×plant series gets 12 weekly rows; chosen `model` + `backtestWape` persisted; on demo data every series' winning WAPE ≤ 0.25 | integration |
| F3-AC2 | Buyer on `/forecasts?tab=demand` after a run | selects series `WR-5.5-HC · RNC` | Chart `[data-testid="demand-chart"]` renders history + 12-week forecast; WAPE badge `[data-testid="wape-badge"]` shows the persisted value; zero console errors | browser-verify |
| F3-AC3 | Same seed, same data, run twice | compare outputs | Forecast values identical across runs (deterministic config) | unit |

**Error cases:**

| ID | Case | Expected behavior | Verify |
|----|------|-------------------|--------|
| F3-ERR1 | Series with <26 weeks of history | Series marked `INSUFFICIENT_HISTORY`; excluded from recommendations; listed in run warnings; UI shows an "insufficient history" chip instead of a chart | integration |
| F3-ERR2 | Backtest attempted with training window overlapping holdout | Guard raises `LEAKAGE_GUARD` and the run fails that series loudly rather than reporting an inflated WAPE | unit |

**Known pitfalls to anticipate:**
- Rolling-origin evaluation must re-fit per fold; a single fit scored on 26 weeks is leakage-adjacent and inflates confidence.
- Week bucketing: ISO weeks, Monday start, consistent across engine and UI.
- LightGBM: `deterministic=true`, `num_threads=1`, fixed seed — or F3-AC3/F5-AC1 flake.

**Dependencies:** F2 (committed data).
**Out of scope:** promotional/exogenous demand drivers; order-book integration (consumption history only in v1).

---

### F4 · Price band engine — P0 · complexity: medium

**User story:** As a buyer, I want a P10/P50/P90 price band at 1-, 4-, and 12-week horizons with its historical coverage shown, so I act on ranges — not on a pretend point forecast.

**Description:** Engine service. Per grade_family. Quantile LightGBM (α = 0.1/0.5/0.9) on features: lagged prices (1–8w), momentum, rolling volatility, calendar. Baseline: random-walk band from historical return quantiles. Backtest reports **empirical coverage** (share of actuals inside P10–P90 over the rolling holdout) and pinball loss; the UI labels the band "decision band," never "prediction." Quantile crossing is repaired by monotonic sort post-process.

**Engine endpoint (internal):** `POST /v1/forecast/price` `{ run_id }` → 200 / 422 / 500.

**Data out (stored as E11 rows):**
```json
{ "runId": "r_01H...", "gradeFamily": "WR-STD", "horizonWeeks": 4, "p10InrMt": 53100, "p50InrMt": 54800, "p90InrMt": 56900, "coverage8090": 0.83, "pinball": 412.7 }
```

**Acceptance criteria:**

| ID | Given | When | Then | Verify |
|----|-------|------|------|--------|
| F4-AC1 | FIX-2 committed | price forecast runs | Bands exist for every grade_family × horizon; `p10 ≤ p50 ≤ p90` holds on every row (post-repair); demo-data coverage ∈ [0.70, 0.90] | integration |
| F4-AC2 | Buyer on `/forecasts?tab=price` | selects `WR-STD` | `[data-testid="price-band-chart"]` renders history + shaded P10–P90 region + P50 line; coverage stat `[data-testid="coverage-badge"]` shown with label "decision band"; zero console errors | browser-verify |
| F4-AC3 | Same seed/data, two runs | compare | Identical band values (deterministic) | unit |

**Error cases:**

| ID | Case | Expected behavior | Verify |
|----|------|-------------------|--------|
| F4-ERR1 | Grade family with <52 weekly price points | Falls back to random-walk baseline band, flagged `BASELINE_FALLBACK` in the run and a chip in the UI — never silently pretends model quality | integration |
| F4-ERR2 | Raw quantile outputs crossed (p10 > p50) | Monotonic repair applied; unit test feeds a crossing case and asserts sorted output + a logged `QUANTILE_REPAIRED` counter | unit |

**Known pitfalls to anticipate:**
- Never leak future prices into lag features at fold boundaries.
- Coverage is the honesty metric — display it even when it's unflattering; do not clamp or hide.

**Dependencies:** F2.
**Out of scope:** driver-level fundamental models (ore, coal, FX inputs) — v1 uses price-series features only; drivers are a documented future extension.

---

### F5 · Play recommendation engine — P0 · complexity: high

**User story:** As a buyer, I want each cycle resolved to one of five plays with quantity, timing, supplier split, expected impact, and the reasoning shown, so my decision is consistent, fast, and defensible.

**Description:** Engine service, the product's core. Inputs per material×plant: demand curve (F3), price band (F4), current inventory + open POs (cover computation), supplier offers = latest observed prices per supplier ± configured deltas, lead times, and the active `PolicyConfig`. A MILP (OR-Tools) minimizes expected landed cost over a 12-week horizon subject to: cover ≥ `min_cover_days` at all times, supplier share ≤ `max_supplier_share_pct` (trailing 90d incl. proposal), optional working-capital cap. Monte Carlo (500 seeded price paths from the band) produces an expected-impact range. A deterministic classifier maps the optimal solution to exactly one play: `BUY_NOW`, `WAIT`, `PARTIAL_BUY`, `HEDGE_LOCK` (memo-only), `SPLIT_SUPPLIERS`. Rationale is a structured JSON — templated, auditable, no LLM.

**Engine endpoint (internal):** `POST /v1/recommend` `{ run_id }` → 200 / 422 / 500.

**Data out (stored as E13, one per material×plant per run):**
```json
{
  "id": "rec_01H...", "runId": "r_01H...", "materialCode": "WR-5.5-HC", "plantCode": "RNC",
  "play": "BUY_NOW",
  "orderLines": [ { "supplierCode": "TATA_LP", "qtyMt": 850.000, "targetWeek": "2026-07-13", "estPriceInrMt": 54200 } ],
  "expectedImpact": { "costDeltaInr": -1830000, "costDeltaP10Inr": -3400000, "costDeltaP90Inr": -200000, "wcDeltaInr": 46070000, "coverAfterDays": 34.5 },
  "rationale": {
    "inputs": { "coverDays": 18.2, "minCoverDays": 21, "band4w": { "p10": 53100, "p50": 54800, "p90": 56900 }, "spotInrMt": 53700, "spread": { "TATA_LP": 54200, "JSW": 54650, "IMPORT": 53900 } },
    "drivers": [ { "factor": "COVER_BELOW_FLOOR", "detail": "18.2d vs 21d policy floor" }, { "factor": "BAND_RISING", "detail": "P50 +2.0% vs spot at 4w" } ],
    "constraintsRespected": [ "MIN_COVER_21D", "MAX_SUPPLIER_SHARE_60" ]
  },
  "status": "PENDING"
}
```

**Acceptance criteria:**

| ID | Given | When | Then | Verify |
|----|-------|------|------|--------|
| F5-AC1 | FIX-3 scenario (cover 18.2d < 21d floor, rising band) | run completes | The `WR-5.5-HC · RNC` recommendation has `play == "BUY_NOW"`, ≥1 order line, and `rationale.drivers` containing `COVER_BELOW_FLOOR` — deterministically, across repeated runs | integration |
| F5-AC2 | Any produced recommendation | inspect solution | Cover never dips below `min_cover_days` in the 12-week simulation of the proposed plan; no supplier exceeds `max_supplier_share_pct`; violations impossible by construction (assert on the MILP solution check) | unit |
| F5-AC3 | FIX-2 steady scenario for `WR-8-MS · HSP` (comfortable cover, flat band) | run completes | `play == "WAIT"` with zero order lines and driver `COVER_COMFORTABLE` | integration |

**Error cases:**

| ID | Case | Expected behavior | Verify |
|----|------|-------------------|--------|
| F5-ERR1 | MILP infeasible (e.g. WC cap conflicts with cover floor) | Recommendation emitted with `play:"PARTIAL_BUY"` best-effort **only if** a relaxed solve (drop WC cap, keep cover floor) succeeds; else a `NO_FEASIBLE_PLAN` recommendation-level error row with the binding constraints named; run does not crash | integration |
| F5-ERR2 | Missing price band for a material's grade_family | That series skipped with run warning `MISSING_PRICE_BAND`; other series unaffected | integration |
| F5-ERR3 | Solver exceeds 30s for one series | Solve aborted, series marked `SOLVER_TIMEOUT`, run continues | unit |

**Known pitfalls to anticipate:**
- Cover must account for open POs by delivery week, not just on-hand stock.
- Seed the Monte Carlo path generator; unseeded paths make `expectedImpact` flake tests.
- `HEDGE_LOCK` produces a memo line only (non-goal: execution) — the classifier may select it, but order lines must be empty for it.
- Supplier share constraint is trailing-90-day *including* the proposed lines — compute the denominator once, in SQL, tested.

**Dependencies:** F3, F4, active PolicyConfig (seeded default: `min_cover_days=21`, `target_cover_days=35`, `max_supplier_share_pct=60`, `service_level_pct=95`, `wc_cap_inr=null`).
**Out of scope:** reinforcement learning; multi-material joint optimization (per material×plant independently in v1).

---

### F6 · Buyer's cockpit & decision workflow — P0 · complexity: high

**User story:** As a buyer, I want a dashboard of cover, bands, spreads, and pending recommendations, and a detail view where I approve, override, or reject with a note, so every decision is one screen and permanently audited.

**Description:** Two surfaces. **Dashboard `/`**: tiles per tracked material×plant (cover days vs. floor, 4w band direction, best supplier spread, pending-rec count), latest-run banner, alert count. **Detail `/recommendations/:id`**: full rationale rendered from the JSON (inputs, drivers, constraint chips, expected impact range), order lines table, and a decision bar. Decisions create an immutable `DecisionRecord`; a recommendation can be decided exactly once; new runs mark undecided older recs `EXPIRED`.

**Routes & network:**

| Route | Method | Purpose | Expected status |
|-------|--------|---------|-----------------|
| `/` | GET | Dashboard | 200 |
| `/recommendations` | GET | List (filter: status, material, plant) | 200 |
| `/recommendations/:id` | GET | Detail | 200 / 404 |
| `/api/recommendations` | GET | List JSON | 200 |
| `/api/recommendations/:id/decision` | POST | Record decision | 201 / 400 / 401 / 403 / 409 |

**Happy path:**
1. Buyer logs in; dashboard tile for `WR-5.5-HC · RNC` shows cover 18.2d in red vs. 21d floor and "1 pending recommendation".
2. Buyer clicks through to `/recommendations/rec_01H...`; rationale panel `[data-testid="rationale-panel"]` shows drivers and constraint chips; impact range rendered as P10–P90 bar.
3. Buyer clicks `[data-action="approve"]`, confirms in the modal; `POST .../decision` returns 201; status chip flips to `APPROVED`; audit line "Approved by buyer@… at …" appears; decision buttons disappear.

**Data in (decision):**
```json
{ "action": "APPROVE", "note": "" }
```
`action ∈ APPROVE | OVERRIDE | REJECT`; `note` required (≥10 chars) for OVERRIDE and REJECT; OVERRIDE additionally requires `{ "override": { "play": "WAIT" } }`.

**Data out / side effects:** `DecisionRecord` row (immutable); `Recommendation.status` updated; audit entry visible on detail.

**Acceptance criteria:**

| ID | Given | When | Then | Verify |
|----|-------|------|------|--------|
| F6-AC1 | FIX-3 run complete; buyer session | open `/` | Tile `[data-testid="tile-WR-5.5-HC-RNC"]` shows cover in breach styling and pending count 1; zero console errors | browser-verify |
| F6-AC2 | On the detail page of the pending FIX-3 rec | click `[data-action="approve"]` and confirm | `POST /api/recommendations/:id/decision` → 201; status chip `[data-testid="status-chip"]` = "APPROVED"; audit entry rendered; buttons removed | browser-verify |
| F6-AC3 | Buyer overrides a pending rec with play WAIT and a 20-char note | submit | 201; status `OVERRIDDEN`; detail shows both the system play and the human play side-by-side with the note | browser-verify |

**Error cases:**

| ID | Case | Expected behavior | Verify |
|----|------|-------------------|--------|
| F6-ERR1 | Second decision on an already-decided rec (stale tab) | 409 `{ code:"ALREADY_DECIDED" }`; UI toast "Already decided by <user>" and page refreshes to current state | browser-verify |
| F6-ERR2 | OVERRIDE submitted with empty note | 400 `{ code:"NOTE_REQUIRED" }`; inline field error; nothing recorded | browser-verify |
| F6-ERR3 | Decision POST times out (engine/db slow) | Button spinner ≤10s, then inline "Couldn't record decision — retry"; idempotency key on the request makes retry safe (no double DecisionRecord) | integration |

**Known pitfalls to anticipate:**
- Double-submit: disable buttons on click AND enforce uniqueness server-side (`UNIQUE(recommendation_id)` on DecisionRecord).
- Render rationale from the stored JSON — never recompute on the client, or the audit view can drift from what was decided on.
- Recharts + Next SSR: render charts client-side (`dynamic import, ssr:false`) to avoid hydration mismatch.

**Dependencies:** F1, F5.
**Out of scope:** approver countersign thresholds (future); editing decisions (never — immutable).

---

### F7 · Risk alerts — P1 · complexity: medium

**User story:** As a buyer, I want the system to flag cover breaches, concentration breaches, widening bands, and price spikes the moment a run computes them, so nothing waits for me to notice a chart.

**Description:** Alert evaluation runs at the end of every run over committed data + fresh outputs. Types and default triggers: `COVER_BREACH` (projected cover < floor within 4 weeks), `CONC_BREACH` (trailing-90d supplier share > cap), `BAND_WIDENING` ((P90−P10)/P50 > 8% at 4w), `PRICE_SPIKE` (index w/w move > 3%). Severity `INFO|WARN|CRITICAL`. In-app only: bell count in the nav + `/alerts` list; acknowledging stores who/when.

**Routes:** `GET /alerts` (200) · `GET /api/alerts?status=OPEN` (200) · `POST /api/alerts/:id/ack` (200/409).

**Acceptance criteria:**

| ID | Given | When | Then | Verify |
|----|-------|------|------|--------|
| F7-AC1 | FIX-3 scenario run | open `/alerts` | A `COVER_BREACH · CRITICAL` alert for `WR-5.5-HC · RNC` is listed linking to its recommendation; nav bell `[data-testid="alert-bell"]` shows count ≥1 | browser-verify |
| F7-AC2 | Open alert | buyer clicks `[data-action="ack-alert"]` | 200; alert moves to Acknowledged with actor + timestamp; bell decrements | browser-verify |

**Error cases:**

| ID | Case | Expected behavior | Verify |
|----|------|-------------------|--------|
| F7-ERR1 | Ack on already-acknowledged alert | 409 `ALREADY_ACKED`; list refreshes | integration |
| F7-ERR2 | Run with no alert conditions met | Zero new alerts; `/alerts` empty state renders (no crash on empty list) | integration |

**Dependencies:** F5 outputs, F2 data.
**Out of scope:** email/SMS/WhatsApp delivery (non-goal); alert routing rules per user.

---

### F8 · Value tracking & pilot report — P1 · complexity: medium

**User story:** As the approver, I want every decision logged against an agreed baseline with cumulative value, so the pilot go/no-go is decided by a number both sides trust.

**Description:** For each decided recommendation, value = (baseline cost − plan cost) for the decided quantity. **Baseline formula v1:** decision-month average committed market price × quantity (documented on the report page; see TODO in §14 — the formula must be countersigned by the client before pilot go-live). Plan cost = order lines qty × estimated price; when matching actual POs are later uploaded (matched by supplier+material+week ±1), actuals replace estimates and the row is marked `ACTUALIZED`. `/reports/pilot` shows: cumulative value line, decisions table (system play vs. human action), forecast-quality panel (WAPE, band coverage), and adoption stats (% recs decided).

**Routes:** `GET /reports/pilot` (200) · `GET /api/reports/pilot` (200).

**Acceptance criteria:**

| ID | Given | When | Then | Verify |
|----|-------|------|------|--------|
| F8-AC1 | One approved FIX-3 rec + FIX-2 prices | open `/reports/pilot` | Decisions table shows the approval with baseline, plan cost, and value ₹ formatted (`₹ 12,34,567` Indian grouping); cumulative chart `[data-testid="value-chart"]` renders; zero console errors | browser-verify |
| F8-AC2 | A later `purchase_orders` upload contains a matching actual PO | recompute report | The decision row flips to `ACTUALIZED` and value recalculates from the actual price | integration |

**Error cases:**

| ID | Case | Expected behavior | Verify |
|----|------|-------------------|--------|
| F8-ERR1 | No decisions yet | Report renders an explicit "no decisions in period" empty state with the baseline formula still visible | browser-verify |
| F8-ERR2 | Baseline month has zero committed market prices | Value for that row shows `BASELINE_UNAVAILABLE` badge and is excluded from the cumulative line (never silently zero) | integration |

**Known pitfalls to anticipate:**
- Indian number grouping (lakh/crore commas) — use `Intl.NumberFormat('en-IN')`, not manual regex.
- Never mutate a decision's stored inputs when actualizing — add fields, keep the original estimate visible.

**Dependencies:** F5, F6, F2.
**Out of scope:** CFO-grade P&L attribution; multi-period fiscal reporting.

---

### F9 · AI weekly memo — P1 · complexity: medium

**User story:** As the approver, I want a one-page plain-language memo of the week's runs, recommendations, decisions, and alerts, so I can forward a summary without writing it myself.

**Description:** Button on `/reports/pilot` (`[data-action="generate-memo"]`). The web server assembles a structured JSON of the week (aggregates only — counts, plays, values, alert summaries, forecast-quality stats; no credentials, no user emails, no free-text notes) and calls the Anthropic API. Output is schema-validated JSON rendered to the page and stored. Feature-flagged: if `ANTHROPIC_API_KEY` is absent, the button produces the deterministic template memo instead, with a visible "template mode" notice.

**Routes & network:**

| Route | Method | Purpose | Expected status |
|-------|--------|---------|-----------------|
| `/api/memo` | POST | Assemble week JSON, call model (or template), store + return memo | 200 / 401 / 403 (viewer) |

**AI behavior:**

| Aspect | Specification |
|--------|--------------|
| Model | Anthropic API, model id from `MEMO_MODEL` env (default `claude-sonnet-4-6`), pinned in config |
| Prompt artifact | `prompts/weekly-memo.md` (system) + `prompts/weekly-memo.schema.json` (output contract) |
| Input contract | Aggregated week JSON: `{ period, runs, recommendationsByPlay, decisions, valueInr, alerts, forecastQuality }`. MUST NOT include: user emails, decision notes, supplier contract terms, any env/config values |
| Output contract | JSON: `{ "headline": string≤120, "summaryMd": string≤2500, "keyNumbers": [{label, value}]≤6, "risks": [string]≤4 }` — validated with zod; invalid ⇒ fallback path |
| Latency budget | p95 ≤ 8s per memo · Cost ≤ $0.05/memo |
| Fallback | On timeout (10s), API error, or schema-invalid output: retry once → deterministic template memo built from the same input JSON, flagged `"mode":"TEMPLATE"` |
| Safety | Free-text from users never enters the prompt (aggregates only) — removes prompt-injection surface; memo stored with mode + model id for audit |
| Eval method | FIX-4 golden set (10 weekly inputs) in `evals/memo/`; assert schema-validity rate ≥ 95%, headline non-empty, zero leakage of forbidden fields (string-scan). ACs never assert exact generative text |

**Acceptance criteria:**

| ID | Given | When | Then | Verify |
|----|-------|------|------|--------|
| F9-AC1 | `ANTHROPIC_API_KEY` set; a week of FIX-2/FIX-3 activity | click `[data-action="generate-memo"]` | 200 within 10s; memo panel `[data-testid="memo-panel"]` renders headline + summary + key numbers; stored memo row has `mode:"LLM"` and validates against the schema | integration + browser-verify |
| F9-AC2 | FIX-4 golden set | run `evals/memo` | Schema-validity ≥ 95%; forbidden-field scan finds zero occurrences | unit |

**Error cases:**

| ID | Case | Expected behavior | Verify |
|----|------|-------------------|--------|
| F9-ERR1 | `ANTHROPIC_API_KEY` unset | Memo generates in template mode; notice chip "AI memo off — template mode" rendered; no API call attempted | integration |
| F9-ERR2 | API timeout | One retry, then template fallback with `mode:"TEMPLATE"`; user sees the memo either way, never an error dead-end | integration |
| F9-ERR3 | Model returns schema-invalid JSON | Validation rejects; fallback path as F9-ERR2; invalid payload logged (truncated) for eval improvement | unit |

**Dependencies:** F5, F6, F7, F8 data; ENV-4.
**Out of scope:** interactive chat, memo email delivery, Hindi output (future).

---

## 7. Data model

### Entities

| ID | Entity | Description | Key fields |
|----|--------|-------------|------------|
| E1 | User | Login + role | id, email (unique), password_hash, role, last_login_at |
| E2 | Plant | Manufacturing site | id, code (unique), name |
| E3 | Material | Purchasable grade | id, code (unique), description, grade_family, uom (`MT`) |
| E4 | Supplier | Source of material | id, code (unique), name, type (`DOMESTIC|IMPORT`), lead_time_days |
| E5 | PurchaseOrder | Committed PO line | id, po_number, po_date, supplier_id, material_id, plant_id, qty_mt, unit_price_inr, delivery_date, upload_batch_id · UNIQUE(po_number, material_id, delivery_date) |
| E6 | ConsumptionRecord | Usage per day | id, date, material_id, plant_id, qty_mt, upload_batch_id |
| E7 | InventorySnapshot | Stock on a date | id, as_of_date, material_id, plant_id, qty_mt, upload_batch_id |
| E8 | MarketPrice | Index price point | id, date, source, grade_family, price_inr_mt, upload_batch_id · UNIQUE(date, source, grade_family) |
| E9 | Run | One recompute | id, status (`QUEUED|RUNNING|DONE|FAILED`), started_at, finished_at, warnings jsonb, counts jsonb |
| E10 | DemandForecast | Weekly qty forecast | id, run_id, material_id, plant_id, week, p50_qty_mt, model, backtest_wape |
| E11 | PriceForecast | Band per horizon | id, run_id, grade_family, horizon_weeks, p10_inr_mt, p50_inr_mt, p90_inr_mt, coverage_8090, pinball |
| E12 | PolicyConfig | Versioned policy | id, min_cover_days, target_cover_days, max_supplier_share_pct, service_level_pct, wc_cap_inr (nullable), is_active, created_by, created_at |
| E13 | Recommendation | Play per series per run | id, run_id, material_id, plant_id, play, order_lines jsonb, expected_impact jsonb, rationale jsonb, status (`PENDING|APPROVED|OVERRIDDEN|REJECTED|EXPIRED`) |
| E14 | DecisionRecord | Immutable human decision | id, recommendation_id (UNIQUE), action, note, override jsonb (nullable), decided_by (user_id), decided_at, idempotency_key (UNIQUE) |
| E15 | Alert | Risk flag | id, run_id, type, severity, material_id (nullable), plant_id (nullable), payload jsonb, status (`OPEN|ACKED`), acked_by, acked_at |
| E16 | UploadBatch | One file ingest | id, type, filename, status (`STAGED|COMMITTED|FAILED`), rows, valid_rows, errors jsonb, uploaded_by, created_at |
| E17 | Memo | Stored weekly memo | id, period_start, period_end, mode (`LLM|TEMPLATE`), model_id (nullable), content jsonb, created_by, created_at |

### Relationships

- E9 Run 1→many E10, E11, E13, E15. E13 Recommendation 1→0..1 E14 DecisionRecord (UNIQUE enforces decide-once). E16 UploadBatch 1→many E5/E6/E7/E8 rows. E12 PolicyConfig: exactly one row with `is_active=true` at any time (partial unique index).

### Constraints & invariants

- **Casing convention:** DB columns are `snake_case`; all API payloads are their `camelCase` mappings (e.g. `order_lines` ↔ `orderLines`). JSON examples in §6 show the API shape.
- **DecisionRecord is append-only.** No UPDATE or DELETE path exists in the app; `UNIQUE(recommendation_id)` guarantees decide-once; `idempotency_key` makes retries safe.
- `Recommendation.status` transitions: `PENDING → APPROVED|OVERRIDDEN|REJECTED` (via DecisionRecord) or `PENDING → EXPIRED` (superseded by a newer run). No other transitions.
- All `qty_mt > 0`; all `*_inr` are integers ≥ 0; `p10 ≤ p50 ≤ p90` on every E11 row.
- Analytical rows (E10/E11/E13/E15) are never updated in place — new run, new rows.
- Policy edits create a new E12 row and deactivate the old one; historical recommendations keep pointing at the policy values embedded in their `rationale.inputs`.

---

## 8. External integrations

| Service | Purpose | Auth | Env vars (names) | Rate limits | On failure |
|---------|---------|------|------------------|-------------|-----------|
| Anthropic API | F9 weekly memo generation | API key header | ENV-4, ENV-5 | Respect provider limits; ≤1 call per memo + 1 retry | Retry once → deterministic template memo (never blocks workflow) |

*(SAP and market-data feeds are deliberately NOT integrations in v1 — see non-goals; data arrives by file.)*

---

## 9. Environment & configuration

| ID | Variable | Purpose | Source | If missing |
|----|----------|---------|--------|-----------|
| ENV-1 | `DATABASE_URL` | Postgres connection (web + engine) | Compose default / client VM | App refuses to boot with named error |
| ENV-2 | `ENGINE_URL` | Web → engine base URL | Compose default `http://engine:8000` | Web boots; runs fail fast with `ENGINE_UNAVAILABLE` |
| ENV-3 | `AUTH_SECRET` | Auth.js JWT signing | Generated per deploy | App refuses to boot with named error |
| ENV-4 | `ANTHROPIC_API_KEY` | F9 memo | Anthropic console | F9 runs in template mode with visible notice (feature-flag off) |
| ENV-5 | `MEMO_MODEL` | Model id pin for F9 | Config choice | Defaults to `claude-sonnet-4-6` |
| ENV-6 | `APP_ENV` | `development|production` toggles (log level, secure cookies) | Deploy config | Defaults to `development` |

**Rule:** the app fails fast with a named error on missing required vars — no silent fallbacks to production defaults. No secret values in this document, the repo, or logs.

---

## 10. Test fixtures & seed data

| ID | Fixture | Contents | Used by |
|----|---------|----------|---------|
| FIX-1 | Test users | `viewer@pdi.test`, `buyer@pdi.test`, `approver@pdi.test`, `admin@pdi.test` — password set by the seed script (test-only constant defined in `seed/users.ts`; must be rotated for any client-facing deploy) | All auth'd ACs |
| FIX-2 | Demo dataset (RNG seed 42, deterministic) | 36 months: plants `RNC`, `HSP`; materials `WR-5.5-HC`, `WR-8-MS`, `WR-12-LRPC` (grade_family `WR-STD` ×2, `WR-LRPC`); suppliers `TATA_LP` (lead 12d), `JSW` (14d), `IMPORT_GEN` (45d); weekly consumption with seasonality+noise; PO history priced in the ₹52k–58k band with realistic quarterly swings; weekly market_prices series; current inventory snapshots; default active PolicyConfig (21/35/60/95/null) | F2–F9 ACs |
| FIX-3 | Breach scenario | Within FIX-2: `WR-5.5-HC · RNC` inventory tuned so projected cover = 18.2d (< 21d floor) with a rising band → deterministic `BUY_NOW`; `WR-8-MS · HSP` tuned comfortable/flat → deterministic `WAIT` | F5-AC1, F5-AC3, F6, F7, F8 ACs |
| FIX-4 | Memo golden set | 10 weekly-aggregate JSON inputs incl. edge weeks (zero decisions, all-rejected, high alerts) in `evals/memo/` | F9-AC2 |
| FIX-5 | Malformed upload | `fixtures/bad_consumption.csv`: negative qty row, invalid date row, unknown plant row, header intact | F2-ERR2 |

**Seed command expectation:** `pnpm seed` — idempotent, wipes and reloads demo data to the exact seeded state (safe to run before every test suite).

---

## 11. Non-functional requirements

### Performance
- Full recompute (FIX-2 scale: ~5 series, 36 months) completes < 120s; dashboard and report pages TTI p95 < 2s locally; upload validation of a 50k-row file < 30s.

### Security & auth
- Server-side RBAC on every route and mutation (see F1 matrix); session via Auth.js JWT cookies (`Secure`, `HttpOnly` in production).
- Secrets only via env vars; engine not exposed publicly; uploads size-capped (20 MB) and parsed defensively.
- Data sensitivity: commercial pricing data — no third-party analytics/telemetry beacons in the app.

### Accessibility
- Target WCAG 2.1 AA; charts carry text equivalents (current values in accessible tables).

### Observability
- Structured logs (request id, user id, run id); every Run stores timings + warnings; decision and ack events logged with actor; LLM calls logged with mode/model/latency (never full prompts with data in production logs).

---

## 12. Success metrics & launch criteria

### Launch criteria (v1 is "done" when)

- [ ] All P0 ACs pass at their tagged verification layer
- [ ] All `browser-verify` ACs return PASS from the `browser-verifier` subagent
- [ ] `production-readiness` verdict is SHIP or SHIP-WITH-FIXES
- [ ] The FIX-3 walkthrough (login → dashboard breach tile → recommendation detail → approve → audit entry → alert ack → pilot report row) completes with zero console errors
- [ ] `README` quickstart gets a fresh machine from clone to seeded demo in ≤ 15 minutes

### Post-launch metrics (pilot)

| Metric | Target | Measured how |
|--------|--------|--------------|
| Decisions made through the platform | ≥ 90% of buys in pilot scope | DecisionRecord count vs. client PO log |
| Demand backtest WAPE (pilot series) | ≤ 25% | F3 persisted metric |
| Price band empirical coverage (P10–P90) | 80% ± 10pp | F4 persisted metric |
| Measured value vs. agreed baseline | Positive and ≥ platform run cost | F8 report |
| Time from run to decision | median ≤ 1 business day | Run.finished_at → DecisionRecord.decided_at |

---

## 13. Glossary

| Term | Definition |
|------|-----------|
| Grade / Material | A specific purchasable wire-rod specification (e.g. 5.5mm high-carbon). "Grade family" groups materials that share a market price series. NOT a quality rating. |
| Plant | A client manufacturing site consuming material. |
| Cover (days) | On-hand stock + open-PO arrivals, divided by forecast daily demand — how long before stock-out at forecast consumption. |
| Play | One of exactly five recommendation outcomes: `BUY_NOW`, `WAIT`, `PARTIAL_BUY`, `HEDGE_LOCK`, `SPLIT_SUPPLIERS`. |
| Band / P10-P50-P90 | Quantile range for future price: 10% chance below P10, 50% median, 10% chance above P90. A *decision band*, never a point prediction. |
| Coverage | Backtest share of actual prices that landed inside the P10–P90 band. The honesty metric for F4. |
| WAPE | Weighted absolute percentage error — sum(|actual−forecast|)/sum(actual) over the backtest window. |
| Pinball loss | Standard quantile-forecast accuracy metric; lower is better. |
| Run | One end-to-end recompute: forecasts → recommendations → alerts, all rows stamped with its `run_id`. |
| Recommendation | The system's proposed play for one material×plant in one run. NOT an order — nothing is transacted. |
| Decision | The immutable human record (approve/override/reject) on a recommendation. An *override* records the human's alternative play. |
| Baseline | The agreed counterfactual cost formula used to value decisions (v1: decision-month average market price × quantity). |
| Spread | The live price gap between suppliers for the same material. |
| Landed cost | Unit price as purchased in v1 (freight/duties folded into supplier price rows; no separate landed-cost model). |

---

## 14. Open questions & assumptions register

### Open questions (agent must NOT resolve these)

- [x] RESOLVED (2026-07-11, product owner): Pilot series = `WR-5.5-HC · RNC` (demo default; re-confirm when the client SAP extract arrives and remap if the contract names a different grade/plant).
- [ ] TODO (narrowed 2026-07-11): Baseline formula — v1 formula stays as built (product-owner decision); client-finance countersign still pending before go-live. Only reopens F8 math if finance rejects it.
- [x] RESOLVED (2026-07-11, product owner): `HEDGE_LOCK` is visible in the pilot UI, rendered like any play with its memo-only rationale (no execution path exists regardless — §3 non-goal).

### Assumptions register

| # | Assumption | Confidence | Impact if wrong |
|---|-----------|------------|-----------------|
| 1 | ASSUMPTION(high): Monorepo Next.js + FastAPI + Postgres via Docker Compose matches the builder's standard hybrid pipeline | high | Restack early; PRD features unchanged |
| 2 | ASSUMPTION(med): File-based SAP-export ingestion is acceptable for the pilot; no live SAP connectivity needed | med | F2 gains an adapter feature; timeline of M1 grows |
| 3 | ASSUMPTION(med): Deterministic synthetic demo data is a valid stand-in until client SAP extracts arrive | med | Fixtures re-cut from real extracts; ACs keep shape, thresholds re-tuned |
| 4 | ASSUMPTION(high): All recommendation reasoning is deterministic/templated; the LLM touches only the weekly memo | high | If client demands NL explanations, add an F9-style bounded feature — never inject LLM into F5 |
| 5 | ASSUMPTION(med): Credentials auth (no SSO) suffices for a pilot of ≤10 users | med | Add SSO provider via Auth.js; role model unchanged |
| 6 | ASSUMPTION(med): Weekly decision cadence — manual run trigger is enough; no scheduler in v1 | med | Add cron container later; Run model already supports it |
| 7 | ASSUMPTION(low): Supplier "offers" proxied by latest observed transaction prices ± spread is realistic enough for the pilot | low | Add a manual offer-entry form (small F2 extension) |

---

## Appendix A — Wireframes / references

- Dashboard and recommendation-detail layouts follow Figures 5–6 ("buyer's cockpit" wireframes) in `UshaMartin_Procurement_Intelligence.docx` — link the client copy in `docs/references/`; do not embed.
- Decision framework, prediction stack, and value-bridge logic follow §4–6 and §13 of the same document.

## Appendix B — Changelog

| Version | Date | Author | Change |
|---------|------|--------|--------|
| v1 | 2026-07-07 | human+agent | Initial draft |
| v1.1 | 2026-07-09 | agent (T1) | §4 stack versions resolved against current stable at lockfile creation: Next 16.x (not 15.x), React 19.2, TypeScript 6.0.3 (lint-toolchain cap), Tailwind v4 (CSS-first config). All PROPOSED items; §0 rule 3 applied. |
| v1.1 | 2026-07-09 | agent (plan) | Delegated decisions recorded: D1 papaparse + exceljs streaming (F2 parsing), D2 decision immutability via app layer + UNIQUE constraints (no trigger), D3 web-side sequential run orchestrator — details in docs/EXECUTION_PLAN.md §C. |
| v1.1 | 2026-07-10 | agent (T22) | E13 Recommendation gains `status: ERROR` and nullable `play` (CHECK: play IS NULL ⟺ status = 'ERROR') so F5-ERR1's "NO_FEASIBLE_PLAN recommendation-level error row" (and SOLVER_TIMEOUT/MODEL_INVALID) persists instead of surfacing as a run-warning-only fallback. Two-phase migration (`0002_tiny_wilson_fisk` adds the enum value, `0003_far_famine` drops NOT NULL + adds the CHECK) — Postgres forbids using a freshly-added enum value inside the same transaction that adds it. |
| v1.1 | 2026-07-11 | agent (M7) | FIX-3 seeded cover measures 16.6d (not the §6/§10 narrative's 18.2d): seed sizes inventory on trailing-8w consumption while the engine's cover denominator is forward-4w P50 (spike A2). All breach invariants and ACs hold (16.6 < 21 floor, deterministic BUY_NOW); narrative figure left as-is, flagged for the pilot-scope TODO owner. |
| v1.1 | 2026-07-11 | agent (T35) | F9 deployment note: default `MEMO_MODEL` (claude-sonnet-4-6) generation time straddles the locked 10s timeout on content-rich weeks → frequent template fallback. Pilot deploy pins `MEMO_MODEL=claude-haiku-4-5-20251001` (ENV-5 mechanism, no PRD change): evals 100% schema-valid, 0 leaks, p95 6.8s ≤ 8s, cheaper per memo. Also: model outputs may arrive markdown-fenced — client strips fences before schema validation. |
| v1.2 | 2026-07-12 | agent (F10) | New post-v1 feature F10 — Scenario Simulator ("Strategy Planner", `/sandbox`): read-only what-if sandbox reusing the F5 pure pipeline (`assemble_series_inputs` → override copy → `recommend_series`). Engine `POST /v1/simulate` (writes no E10/E11/E13/E15 rows); web `POST /api/simulate` (MUTATE_DATA roles, synchronous proxy; new envelope codes `NO_COMPLETED_RUN`, `SIMULATION_FAILED`); UI page with policy/lead-time/price-shift/forced-qty knobs and a baseline-vs-simulated comparison. No persistence and no decisions on simulated results (decide-once invariant untouched); deterministic via the same F5 seeds. Not v1 scope and not a §3 non-goal — recorded per §0 rule 6. |
