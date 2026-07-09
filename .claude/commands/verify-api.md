---
description: Verify backend behavior — integration tests for affected endpoints plus live smoke of documented routes.
argument-hint: [feature (F3), endpoint path, or "all"]
---

Scope: $ARGUMENTS, else endpoints touched by the current diff mapped through PRD §6 Routes & network tables (web `/api/*` and engine `/v1/*`, `/health`).

1. Run the integration suite scoped to affected endpoints (`pnpm test` with the right filter; engine: `cd services/engine && uv run pytest -k <filter>`)
2. If the stack runs locally (web http://localhost:3000, engine per ENGINE_URL): curl each in-scope endpoint per its PRD table — happy case + one documented error case each; assert status AND response envelope shape `{ success, data, error }` match the PRD contract
3. Confirm error paths return the documented envelope with SCREAMING_SNAKE codes, not stack traces
4. Confirm auth: protected `/api/*` without session → 401 `UNAUTHENTICATED`; role-gated mutations → 403 `FORBIDDEN_ROLE`

Output a table: endpoint | case | expected (status+shape) | got | verdict. Then `SUMMARY: n PASS / n FAIL`. FAIL → fix and re-run before claiming done.
