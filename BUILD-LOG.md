# BUILD-LOG

## M0 — Walking skeleton (2026-07-10)
Shipped: pnpm monorepo (Next 16 web + @pdi/shared), FastAPI engine (/health + DB ping, MISSING_ENV fail-fast), Docker Compose (postgres 16 + engine + web), web boot env validation via instrumentation.ts.
ACs passed: SKEL-AC1 (browser-verify, screenshot in .claude/verify-artifacts/), SKEL-AC2 (integration, exact JSON).
Surprises: (1) subagent tests passed only via exported shell env — import-time settings load fixed to lazy get_settings(); (2) engine pyproject lacked [build-system] so uv sync never installed the package in Docker — hatchling added; (3) host ports 8000/5432/5433 owned by other projects (aisewak, athena, sentinel) — engine→8100, postgres→5442 loopback; (4) docker-credential-desktop missing from non-login shell PATH — prefix /Applications/Docker.app/Contents/Resources/bin.

## M1 — Auth + data in (2026-07-10)
Shipped: E1-E17 schema + migrations (7 hostile constraint tests), deterministic FIX-1/2/3/5 seed (cover 18.2d/40d, rising band), Auth.js v5 credentials + JWT + middleware RBAC, envelope + withApiAuth guard (explicit roles required), streaming CSV/XLSX ingest lib (39 tests), upload stage/commit state machine, run lifecycle + engine stage stubs, /data page.
ACs passed (14/14 at tagged layers): F1-AC1/2/3, F1-ERR1/2/3, F2-AC1/2/3/4, F2-ERR1/2/3/4. Browser evidence: 7 screenshots in .claude/verify-artifacts/.
Surprises: (1) exceljs streaming reader broken on node25 — non-streaming fallback, bounded by 20MB cap; (2) papaparse abort() fires complete() first — reject-before-abort; (3) two opus reviews each surfaced real WARNs (bcrypt timing enumeration, blank-identity session, roles-by-omission, staged_rows blob on poll) — all fixed pre-commit; (4) runtime `pnpm start` in Docker = corepack network fetch at container start → exit 0; next invoked directly now; (5) Docker daemon wedged mid-build once — hard restart recovered.
