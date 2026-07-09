---
description: Run browser-grounded verification on affected routes/ACs via the browser-verifier subagent.
argument-hint: [route, AC ID (F2-AC1), feature (F2), or "all"]
---

Delegate to the **browser-verifier** subagent.

Scope: $ARGUMENTS if given; otherwise derive affected routes from the current diff mapped through PRD §6 Routes & network tables. "all" = every AC tagged browser-verify.

Preconditions the subagent must respect: dev server on http://localhost:3000 (BLOCKED if down — do not start it); seed fixtures via `pnpm seed` if FIX records are missing; auth'd routes sign in as FIX-1 users.

Paste the subagent's verdict table + SUMMARY verbatim into your response, then screenshot paths. Any FAIL → fix and re-run /verify on the failed ACs before claiming done.
