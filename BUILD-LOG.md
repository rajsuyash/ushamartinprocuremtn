# BUILD-LOG

## M0 — Walking skeleton (2026-07-10)
Shipped: pnpm monorepo (Next 16 web + @pdi/shared), FastAPI engine (/health + DB ping, MISSING_ENV fail-fast), Docker Compose (postgres 16 + engine + web), web boot env validation via instrumentation.ts.
ACs passed: SKEL-AC1 (browser-verify, screenshot in .claude/verify-artifacts/), SKEL-AC2 (integration, exact JSON).
Surprises: (1) subagent tests passed only via exported shell env — import-time settings load fixed to lazy get_settings(); (2) engine pyproject lacked [build-system] so uv sync never installed the package in Docker — hatchling added; (3) host ports 8000/5432/5433 owned by other projects (aisewak, athena, sentinel) — engine→8100, postgres→5442 loopback; (4) docker-credential-desktop missing from non-login shell PATH — prefix /Applications/Docker.app/Contents/Resources/bin.
