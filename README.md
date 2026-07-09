# PDI — Procurement Decision Intelligence

Turns a manufacturer's purchasing/consumption history + market prices into weekly demand forecasts, P10/P50/P90 price bands, and one of five recommended buying plays — with auditable reasoning and mandatory human approval. Recommends; never transacts.

## Prerequisites

- Docker + Docker Compose
- Node 20+ · pnpm
- Python 3.12 · uv

## Quickstart

```bash
cp .env.example .env          # fill values; app fails fast on missing vars
docker compose up             # postgres + engine + web
pnpm seed                     # deterministic demo data (RNG 42) + test users
open http://localhost:3000/login   # buyer@pdi.test (password: see seed/users.ts)
```

## Dev

```bash
pnpm dev 2>&1 | tee .claude/dev-server.log   # web on :3000 (pipe required for smoke-check hook)
pnpm typecheck && pnpm lint && pnpm test      # web checks
cd services/engine && uv run pytest           # engine tests
node evals/run.mjs memo                       # F9 memo evals
```

## Docs

- `docs/PRD.md` — source of truth (features, milestones, ACs)
- `docs/architecture.md` · `docs/conventions.md` · `docs/test-strategy.md` · `docs/known-pitfalls.md`
- `CLAUDE.md` — agent contract for Claude Code sessions

Status: greenfield. First session: `/plan M0` (walking skeleton).
