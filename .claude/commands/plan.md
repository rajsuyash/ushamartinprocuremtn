---
description: Plan the current PRD milestone into an executable task list. Never starts coding.
argument-hint: [milestone id, e.g. M1 — defaults to first milestone with unmet exit criteria]
---

Read `docs/PRD.md` §5 (build sequence M0–M7). Target milestone: $ARGUMENTS if given, else the first whose exit-criteria AC IDs are not yet passing.

1. Load ONLY that milestone's features from §6 (plus §0, §3 non-goals, §4 constraints)
2. Decompose into ordered tasks; each task names the AC IDs it will satisfy and its verification layer (unit / integration / browser-verify / evals)
3. Order vertically: each task leaves the app runnable and demoable; schema-only or UI-only task chains are wrong
4. Tag each task with the feature's complexity (F1/F2/F5/F6 = high; F3/F4/F7/F8/F9 = medium). High-complexity tasks: plan the approach in one paragraph before any code, and schedule `/review` before done.
5. Flag blockers: unmet `TODO:` markers (§14 has three), missing fixtures (§10), missing env vars (§9), human-only tasks

Output: the task table (id, task, ACs, verify layer, complexity), blockers list, and the milestone's demoable check restated. STOP after the plan — do not begin implementation in this invocation.
