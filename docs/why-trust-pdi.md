# How PDI Makes a Recommendation — and Why You Can Trust It

*Procurement Decision Intelligence (PDI) · Two-page briefing for leadership*

---

## Page 1 · How a recommendation is made

PDI turns four files your team already has — purchase orders, consumption, stock, and market prices — into one clear call per material, every week: **buy now, wait, buy partially, split across suppliers, or lock a hedge**. Here is the full chain, with nothing hidden:

**Step 1 — Your data, committed and checked.**
Weekly SAP exports are uploaded and validated row by row. Bad rows (negative quantities, unknown plants, malformed dates) are flagged and excluded before anything is computed. Every downstream number traces back to a specific upload batch.

**Step 2 — Demand forecast, with its error shown.**
Three forecasting methods compete for every material×plant: a simple seasonal baseline, a classical statistical model, and a machine-learning model. They are tested against your own past 26 weeks — each one asked to "predict" history it hasn't seen — and **the method with the lowest real error wins**. That error (WAPE) is printed next to every forecast chart. On current data it runs at 3–5%, against an acceptance gate of 25%.

**Step 3 — A price *range*, never a point guess.**
Nobody can predict next month's steel price to the rupee, and PDI doesn't pretend to. It produces a **decision band**: a range (P10–P50–P90) at 1, 4, and 12 weeks, built from your price history's momentum and volatility. Crucially, the band is back-tested: the "coverage" badge tells you what fraction of actual past prices landed inside the band. Target is 70–90% — currently ~81%. If that number were poor, it would be displayed anyway. **The honesty metric cannot be hidden or clamped — that rule is written into the engineering spec.**

**Step 4 — Optimization under *your* rules.**
A mathematical optimizer (the same class of tool used for airline scheduling) finds the lowest-expected-cost buying plan over the next 12 weeks, subject to hard constraints from your own policy:

- stock cover must never fall below the floor (currently 21 days) — counting stock on hand *plus* POs already on the way;
- no supplier may exceed the concentration cap (currently 60% of trailing 90-day volume);
- an optional working-capital ceiling.

These are not suggestions the model tries to respect — plans that violate them are **mathematically impossible for it to produce**. An independent checker re-verifies every plan after the solve, with separate code.

**Step 5 — One play, with the reasoning attached.**
The optimal plan is classified into one of the five plays by fixed rules. The recommendation you see carries: quantity, target week, supplier split, an expected cost impact (from 500 simulated price scenarios — a range, not one number), and a rationale panel listing the exact drivers ("cover 16.6 days vs 21-day floor", "price band rising") and every constraint respected.

---

## Page 2 · Why you can trust it

**1. It recommends. People decide. Always.**
PDI cannot place, modify, or transmit a purchase order — that capability does not exist in the system. Every recommendation waits for a human to approve, override, or reject. An override records the buyer's alternative and their reason, side by side with the system's proposal.

**2. Every decision is permanent and auditable.**
A decision, once made, can never be edited or deleted — the database itself forbids it. Six months later you can open any decision and see exactly what the system knew, what it proposed, what the human chose, who chose it, and when. The rationale is stored at decision time, so the audit trail can never drift from what was actually on screen.

**3. Same data in, same answer out.**
Every model runs with fixed random seeds and deterministic settings. Re-run last week's data and you get identical numbers — verified by automated tests on every release. There is no "the AI changed its mind"; if a recommendation changes, your data changed.

**4. It grades its own homework, in public.**
Forecast error and band coverage are computed on *your* history by back-testing, and displayed on the same screens as the forecasts — even when unflattering. A system that hides its accuracy asks for faith; PDI shows its accuracy and asks for verification.

**5. Your policy is the law, and you hold the pen.**
Cover floors and supplier caps are set on the policy page by your approver — not by us, not by the model. Old recommendations keep the policy values they were decided under, so tightening a rule never rewrites history.

**6. The value claim is measured, not asserted.**
Every approved decision is scored against a pre-agreed baseline — the decision-month average market price, a formula your finance team countersigns before go-live. When actual POs later arrive, estimates are replaced with actual prices and marked as such. The pilot's go/no-go is that cumulative number — one both sides can recompute by hand.

**7. AI language models never touch the numbers.**
Forecasts, optimization, and classification are traditional, testable mathematics. The only generative-AI feature is the weekly summary memo — it receives aggregated counts only (never prices being decided, never user identities), its output is schema-checked, and if it fails, a plain template takes over. The decision path is 100% deterministic.

**The honest limits.** PDI's forecasts are only as good as the data and the market's continuity — a sudden policy shock or mill outage isn't in any band. That is precisely why the human stays in the loop, why alerts flag anomalies early, and why every number carries its own accuracy score. The system is designed to earn trust weekly, not to demand it upfront.

*Demo: https://web-production-24fb3.up.railway.app · credentials on the login page.*
