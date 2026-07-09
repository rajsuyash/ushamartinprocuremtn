---
description: Run golden-set evals for the F9 weekly memo and enforce PRD thresholds.
argument-hint: [defaults to memo — the only AI feature in v1]
---

Delegate to the **eval-runner** subagent. Scope: $ARGUMENTS, else `memo` (run whenever `prompts/`, `evals/`, or memo client code appears in the current diff).

Paste the subagent's metric table (threshold vs measured) + SUMMARY verbatim. Any threshold miss → this change is NOT done; fix the prompt/code (never the golden set) and re-run. Include the cost/token log line for the run.
