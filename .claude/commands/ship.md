---
description: Pre-deploy gate. Runs the production-readiness audit; blocks on missing evidence.
---

Delegate to the **production-readiness** subagent for the full gate.

Preconditions it will enforce (stale or missing evidence = finding, not pass): all P0 ACs green at their tagged layers, latest /verify, /verify-api, /evals results as applicable, secrets scan clean, `.env.example` complete per PRD §9, engine not publicly exposed, FIX-3 walkthrough clean (PRD §12 launch criteria).

Paste the findings table + verdict verbatim. `BLOCK` or `SHIP WITH FIXES` → resolve the list and re-run /ship. Only `SHIP` means ship.
