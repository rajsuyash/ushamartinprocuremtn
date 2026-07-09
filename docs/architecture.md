# Target architecture

Greenfield — this describes what M0–M7 build, not what exists yet.

## System shape

```
                    ┌──────────────────────────────────────────┐
 browser ──────────▶│ apps/web · Next.js :3000                 │
 (buyer/approver)   │  Auth.js (credentials, JWT cookie)       │
                    │  middleware: session + role gate         │
                    │  /api/* route handlers (envelope)        │
                    │  UI: dashboard, /data, /forecasts,       │
                    │      /recommendations, /alerts, /reports │
                    └───────┬──────────────────┬───────────────┘
                            │ internal HTTP    │ Drizzle
                            ▼ ENGINE_URL       ▼
                    ┌──────────────────┐  ┌──────────────┐
                    │ services/engine  │  │ PostgreSQL 16│
                    │ FastAPI :8000    │─▶│ (shared DB)  │
                    │ /v1/forecast/*   │  └──────────────┘
                    │ /v1/recommend    │
                    │ /health          │
                    └──────────────────┘
```

- **Engine is internal-only.** Reachable from the web container, never the public internet. Web enforces auth, then proxies. No auth logic inside the engine.
- **Single shared Postgres.** Web owns schema via drizzle-kit migrations; engine reads committed data and writes run-stamped analytical rows (E10/E11/E13/E15).
- **Anthropic API** is the only external integration (F9 memo, feature-flagged on `ANTHROPIC_API_KEY`).

## Request lifecycle — core journey (run → recommendation → decision)

1. Buyer clicks "Trigger run" on `/data` → `POST /api/runs` (session + role checked) → web creates `Run` row (`QUEUED`), calls engine synchronously per stage.
2. Engine: `POST /v1/forecast/demand` → `POST /v1/forecast/price` → `POST /v1/recommend` — each reads committed data, writes rows stamped with `run_id`. Alerts evaluated at the end. Run → `DONE` (or `FAILED` with code).
3. UI polls `GET /api/runs/:id` until `DONE`.
4. Buyer opens `/recommendations/:id`, decides → `POST /api/recommendations/:id/decision` → immutable `DecisionRecord` (UNIQUE recommendation_id + idempotency_key).

## Where auth lives

- Session: Auth.js JWT cookie, credentials provider, `AUTH_SECRET`.
- Middleware gates all routes except `/login`, `/api/auth/*`, static assets.
- Every mutating route handler re-derives role from the session — never trusts client fields.
- Engine trusts its caller (network-isolated); it never sees user identity except as recorded fields passed explicitly.

## Folder → surface map

| Path | Surface | Verifier |
|------|---------|----------|
| `apps/web/` | web UI + API | `/verify` (browser ACs) · `/verify-api` (route contracts) |
| `services/engine/` | backend analytics | `uv run pytest` · `/verify-api` |
| `packages/shared/` | contracts (zod schemas, enums, envelope) | `pnpm test` |
| `prompts/`, `evals/` | AI (F9 memo) | `/evals memo` |
