#!/usr/bin/env bash
# T27 — single-command P0 regression: seed + web suites + engine suite (M5 exit gate).
# Browser-verify ACs run separately via /verify (test-strategy.md).
set -euo pipefail

cd "$(dirname "$0")/.."

: "${DATABASE_URL:?DATABASE_URL is required (e.g. postgresql://pdi:pdi_dev@127.0.0.1:5442/pdi)}"
export ENGINE_URL="${ENGINE_URL:-http://127.0.0.1:8100}"

echo "== seed (idempotent, RNG 42) =="
pnpm seed

echo "== web: typecheck =="
pnpm typecheck

echo "== web: lint =="
pnpm lint

echo "== web + shared: vitest =="
pnpm test

echo "== engine: pytest =="
(cd services/engine && uv run pytest -q)

echo "== P0 REGRESSION GREEN =="
