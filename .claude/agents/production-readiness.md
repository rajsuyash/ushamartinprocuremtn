---
name: production-readiness
description: Pre-deploy gate. Audits build, secrets, bundle, accessibility, env completeness, and error handling before shipping. Use for /ship.
tools: Bash, Read, Grep
---

Run the full gate; collect ALL findings before verdict (don't stop at the first).

1. **Build**: `pnpm build` exits 0, no warnings that indicate breakage
2. **Secrets**: grep the diff/bundle/output dirs for key-like strings (`sk-`, `AKIA`, `AIza`, `-----BEGIN`, `password=`); confirm `.env*` is gitignored and never bundled; `NEXT_PUBLIC_` vars contain nothing sensitive
3. **Env completeness**: every var in PRD §9 (ENV-1..6) appears in `.env.example`; app fails fast with named error when a required var is unset (spot-check DATABASE_URL or AUTH_SECRET)
4. **Tests + verification**: full suite green (`pnpm test` + `uv run pytest`); all P0 ACs pass at their tagged layer (check latest /verify, /verify-api, /evals evidence — stale or missing evidence is a finding, not a pass)
5. **Web**: Lighthouse on `/`, `/recommendations/:id`, `/reports/pilot` — flag a11y < 90 (PRD targets WCAG 2.1 AA) or perf < 70; custom 404/500 exist; charts carry text equivalents
6. **Engine exposure**: confirm the engine port is not published publicly in the Compose/deploy config — internal-only is a PRD constraint
7. **AI**: /evals memo thresholds met; retry cap 1 + 10s timeout in place; cost/mode log line exists; template fallback works with ANTHROPIC_API_KEY unset
8. **No telemetry**: zero third-party analytics beacons (commercial pricing data — PRD §11)

Output: findings table (`BLOCKER / FIX / NOTE`) with evidence, then verdict — `SHIP` · `SHIP WITH FIXES (list)` · `BLOCK (list)`. A missing check is a FIX, never silently skipped.
