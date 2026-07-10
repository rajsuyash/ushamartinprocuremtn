# T19 SPIKE — F5 Play Recommendation: MILP formulation & play classifier

**Status:** design note (no code). **Unblocks:** T20 (inputs), T21 (solver + classifier + Monte Carlo), T22 (endpoint).
**Sources:** PRD §6 F5, §7 E12/E13, §13 (Cover, Play, Spread), docs/known-pitfalls.md (Analytics), engine `data/readers.py`, `demand/select.py`, `price/select.py`.

Implementers should be able to write T20/T21 from this note without re-deriving anything. Formulas and tables are normative; prose is context. Every judgment the PRD left open is marked **ASSUMPTION** and restated in §7.

---

## 0. Inputs (what T20 assembles, per material×plant series)

| Symbol | Source (reader) | Shape / unit | Notes |
|--------|-----------------|--------------|-------|
| `I0` | `load_inventory_latest()` | MT (float) | latest snapshot qty for this material×plant = on-hand at horizon start (week 0) |
| `d[t]`, t=1..12 | E10 `demand_forecasts` (this run) | MT/week, P50 | winner-model P50 (`demand/select.run_series`). **P50 only** per PRD F3 |
| `band[h]`, h∈{1,4,12} | E11 `price_forecasts` (this run) | (p10,p50,p90) INR/MT int | per **grade_family**; only 3 horizons exist — see §3 interpolation |
| `spot` | `load_market_prices()` latest weekly | INR/MT int | market price at horizon 0 = band anchor `P50[0]` |
| `openPO[t]`, t=1..12 | `load_open_pos(as_of)` bucketed by delivery week | MT/week | arrivals already committed; **cover must count these** (pitfall) |
| `offer_base[s]` | latest `unit_price_inr` per supplier for this material (from `purchase_orders`) | INR/MT int | supplier price level; drift applied in §3 |
| `lead_days[s]` | `load_suppliers()` | days | → `lead_wk[s] = ceil(lead_days[s]/7)` |
| `T_s`, `T_total` | SQL, trailing-90d (§2.4) | MT | committed qty by supplier / all, computed **once in SQL** (pitfall) |
| policy | `load_active_policy()` | — | `min_cover_days`, `target_cover_days`, `max_supplier_share_pct`, `wc_cap_inr` (nullable) |

Series with `<26` demand weeks are already excluded upstream (`INSUFFICIENT_HISTORY`). Series whose grade_family has no E11 band → skip with run warning `MISSING_PRICE_BAND` (F5-ERR2), never solved.

---

## Q1 — Exact MILP formulation

### 1.1 Solver choice — OR-Tools **CP-SAT**, integer-scaled

CP-SAT (not pywraplp/CBC) because: native hard time limit (`max_time_in_seconds`, F5-ERR3), deterministic single-worker search with `random_seed`, clean infeasibility introspection via assumption literals (§Q2.1), and trivially fast on this size (≤3 suppliers × 12 weeks = ≤36 vars). **CP-SAT is integer-only**, so all continuous quantities are scaled to integers:

| Quantity | Native | Integer encoding | Precision |
|----------|--------|------------------|-----------|
| order/inventory qty | MT `numeric(12,3)` | **kilograms** `q_kg = round(MT × 1000)` | exact (3 dp = kg) |
| price | INR/MT (already int) | unchanged | exact |
| landed cost term | INR | `q_kg × price` = 1000 × INR | divide by 1000 at report |
| demand, openPO, I0 | MT | × 1000 → kg (round) | exact to kg |
| share cap / cover floor | pct / days | ×100 / integer days | exact |

All reported INR = `objective / 1000`; all reported MT = `q_kg / 1000`.

### 1.2 Index sets & decision variables

- Weeks `t = 1..12` (H=12). Order/arrival weeks share this index; week 0 = horizon start (`I0`, `spot`).
- Suppliers `s ∈ S` (this material's known suppliers, ≤3 on FIX-2).
- **`q[s,t]`** = order qty (kg, integer ≥ 0) *placed* in week `t`. Bounds `0 ≤ q[s,t] ≤ Q_MAX` (`Q_MAX` = 3 × max weekly demand × 12, a slack ceiling).
- Order placed in week `t` **arrives** in week `t + lead_wk[s]`. Only decisions arriving **within** the horizon are modelled: fix `q[s,t] = 0` for all `t` where `t + lead_wk[s] > 12` (an order arriving after week 12 cannot help in-horizon cover and only consumes WC — **ASSUMPTION A1**).
- **`b[s]`** = Boolean, 1 iff supplier `s` has any week-1 order (for SPLIT materiality / min-order logic; §Q2.2). Linked: `q[s,1] ≤ Q_MAX·b[s]`.
- **`u[t]`** = cover-shortfall slack (kg, integer ≥ 0) for weeks before any order can arrive — see 2.3.

### 1.3 Arrivals & inventory balance

```
arrive[s,t]  = q[s, t − lead_wk[s]]          (0 if t − lead_wk[s] < 1)
new_arr[t]   = Σ_s arrive[s,t]
I[t]         = I[t−1] + openPO[t] + new_arr[t] − d[t]        for t = 1..12
I[0]         = I0
I[t] ≥ 0                                                     (no negative stock)
```
All in kg. `d[t]` = P50 demand (kg). `openPO[t]` = committed arrivals bucketed to ISO-Monday delivery week.

### 1.4 Cover constraint (≥ min_cover_days at all weeks)

Cover in days = on-hand+arrivals divided by **forward average daily demand**. PRD §13 leaves the averaging window open → **ASSUMPTION A2**: forward 4-week mean, tail-clamped (matches F7 `COVER_BREACH` "within 4 weeks" semantics).

```
add[t] = ( Σ_{k=t}^{min(t+3,12)} d[k] ) / ( 7 × (min(t+3,12) − t + 1) )     # avg daily demand, kg/day
cover[t] = I[t] / add[t]                                                     # days
```
`add[t]` is a **constant** (demand is a P50 parameter), so the cover floor is linear:
```
I[t] ≥ min_cover_days × add[t] − u[t]        for t = 1..12
```
**Lead-time reality (FIX-3):** if `I0` is already below floor, no order can lift early weeks (steel can't teleport). So the floor is **hard** for `t ≥ min_s(lead_wk[s])` (earliest achievable arrival) with `u[t]=0`; for earlier weeks `u[t] ≥ 0` is a penalized slack (unavoidable breach) — see objective. This keeps FIX-3 feasible while forcing the earliest possible buy.

### 1.5 Supplier-share constraint (trailing-90d incl. proposal ≤ cap)

Numerator = trailing-90d committed qty for `s` **plus** proposed; denominator = trailing-90d all-supplier **plus** total proposed. `T_s`, `T_total` are constants from SQL (2.4). With `P_s = Σ_t q[s,t]`, `P_total = Σ_s P_s`, cap as pct:
```
100 × (T_s + P_s) ≤ max_supplier_share_pct × (T_total + P_total)     ∀ s ∈ S
```
Linear in `q` (T_s, T_total, cap are constants). Enforced under assumption literal `A_share` (Q2.1).

### 1.6 Trailing-90d denominator (computed **once in SQL**, per pitfall)

```sql
SELECT sup.code AS supplier_code, SUM(po.qty_mt) AS qty_mt
FROM purchase_orders po
JOIN materials m  ON m.id = po.material_id
JOIN plants p     ON p.id = po.plant_id
JOIN suppliers sup ON sup.id = po.supplier_id
WHERE m.code = %(material_code)s AND p.code = %(plant_code)s
  AND po.po_date >= %(as_of)s - INTERVAL '90 days'
  AND po.po_date <= %(as_of)s
GROUP BY sup.code;
```
`T_s` = per-supplier sum, `T_total` = Σ. Window keyed on **`po_date`** (commitment date, matches "trailing-90d share of purchasing") scoped to material×plant — **ASSUMPTION A3**. One query, not per-supplier (avoids N+1, pitfall). T20 exposes `share_denominator(material, plant, as_of) -> {supplier_code: qty_mt}` with a unit test.

### 1.7 Working-capital cap (optional)

Only when `policy.wc_cap_inr IS NOT NULL`:
```
Σ_{s,t} q[s,t] × price[s,t] ≤ wc_cap_inr × 1000        # ×1000 = kg-scaled INR
```
Attached under assumption literal `A_wc` so it is the first thing dropped on infeasibility (Q2.1).

### 1.8 Objective

```
minimize   Σ_{s,t} q[s,t] × price[s,t]                    # landed cost (scaled INR)
         + λ_slack · Σ_t u[t]                             # cover-breach penalty
         + λ_hold  · Σ_{s,t} q[s,t] × (12 − t)            # deterministic timing tie-break
```
- `price[s,t]` = supplier offer drifted by band P50 (§3).
- `λ_slack` = large (e.g. `10 × max_price`) so the solver never accepts an avoidable breach to save cost.
- `λ_hold` = tiny (e.g. `1`) — a **deterministic JIT tie-breaker**, not a real WC model: when the band is flat, buying earlier vs later is cost-indifferent, so without this the "buy nothing" plan for a comfortable/flat series (WR-8-MS·HSP) is non-unique and would flake. `λ_hold` breaks the tie toward *latest feasible* arrival, making WAIT deterministic. **ASSUMPTION A4.** `λ_slack ≫ max cost term ≫ λ_hold × total qty` (strict lexicographic ordering — pick coefficients that guarantee it, asserted in a unit test).

### 1.9 Determinism (contractual — F5-AC1)

| Param | Value |
|-------|-------|
| CP-SAT `random_seed` | `42` (= `LGBM_SEED`) |
| CP-SAT `num_search_workers` | `1` |
| `max_time_in_seconds` | `30` (F5-ERR3 safety valve only; demo solves in ms) |
| Monte Carlo RNG | `numpy.random.Generator(PCG64(42))` |
| Determinism basis | tiny problems reach **OPTIMAL** far under budget → reproducible. A wall-clock *timeout* is a degraded path (`SOLVER_TIMEOUT`), never the AC path. Never rely on an interrupted search for a deterministic AC. |

---

## 3. Price path: interpolation + supplier offer drift

E11 gives band only at horizons 1/4/12. Build a **per-week P50 path** by piecewise-linear interpolation through anchors `(0→spot, 1→P50[1], 4→P50[4], 12→P50[12])`; same for P10/P90 (Monte Carlo, §Q2.3):
```
P50[t] = linear_interp(t; anchors)      t = 1..12     (flat-hold beyond week 12 if ever needed)
```
Supplier price preserves each supplier's observed spread vs market while drifting with the band median:
```
price[s,t] = offer_base[s] × ( P50[t] / spot )
offer_base[s] = latest observed unit_price_inr for s   (± configured delta, default 0)
```
"Configured deltas" have **no schema field** in E4/E12 → **ASSUMPTION A5**: delta = 0 in v1 (offer = latest observed supplier price); a future per-supplier delta column plugs in here without changing the formulation. `rationale.inputs.spread` = `{s: offer_base[s]}`.

---

## Q2 — Infeasibility, classification, impact, rationale

### 2.1 Infeasibility relaxation & binding-constraint detection

Attach each soft constraint group to a CP-SAT **assumption literal** (`OnlyEnforceIf`): `A_wc` (WC cap), `A_share` (share cap), `A_cover` (hard cover floor). Cover slack `u[t]` already makes early-week breach feasible; `A_cover` guards the hard tail floor.

Relaxation order is fixed by **PRD F5-ERR1** — drop WC cap first, keep cover floor:

| Step | Solve with assumptions | Outcome |
|------|------------------------|---------|
| 1 | all true (`A_wc, A_share, A_cover`) | OPTIMAL → normal play (2.2) |
| 2 | drop `A_wc` (keep share + cover) | FEASIBLE → **PARTIAL_BUY** best-effort; rationale notes `WC_CAP_RELAXED` |
| 3 | still INFEASIBLE | **NO_FEASIBLE_PLAN** error row |

Binding constraints for the error row: CP-SAT `model.add_assumptions([...])` + on `INFEASIBLE`, `solver.sufficient_assumptions_for_infeasibility()` returns the minimal literal set that caused infeasibility → map literals back to names (`MIN_COVER_21D`, `MAX_SUPPLIER_SHARE_60`, `WC_CAP`). The run **does not crash** — one series' `NO_FEASIBLE_PLAN` is a recommendation-level error row (F5-ERR1); other series proceed.

### 2.2 Play classifier — deterministic decision tree

Derived quantities from the solved plan:
```
w1_qty       = Σ_s q[s,1] / 1000                      # MT ordered in week 1
w1_suppliers = { s : q[s,1]/1000 ≥ SPLIT_MIN_SHARE × w1_qty }     SPLIT_MIN_SHARE = 0.20
restore_qty  = MT needed to lift projected cover from current to target_cover_days
spread4      = (P90[4] − P10[4]) / P50[4]
rising       = P50[4] > spot × (1 + RISE_EPS)          RISE_EPS = 0.01
comfortable  = projected_cover_days ≥ min_cover_days AND every I[t] holds floor with no week-1 buy
```
Evaluate top-down, **first match wins**:

| # | Condition | Play | Order lines |
|---|-----------|------|-------------|
| 1 | `w1_qty > 0` AND `|w1_suppliers| ≥ 2` | **SPLIT_SUPPLIERS** | week-1 lines, ≥2 suppliers |
| 2 | `w1_qty > 0` AND `w1_qty < RESTORE_FRAC × restore_qty` (`RESTORE_FRAC=0.90`) | **PARTIAL_BUY** | week-1 line(s), partial |
| 3 | `w1_qty > 0` | **BUY_NOW** | week-1 line(s) |
| 4 | `w1_qty == 0` AND not `comfortable` | **BUY_NOW** (defensive) | forced earliest feasible line |
| 5 | `w1_qty == 0` AND `comfortable` AND `spread4 > HEDGE_SPREAD` (`0.08`) | **HEDGE_LOCK** | **empty** (memo-only, pitfall) |
| 6 | else | **WAIT** | **empty** |

Notes: HEDGE_LOCK is memo-only — classifier may pick it but T21 **forces `order_lines = []`** (pitfall). Row 4 is a guard: the MILP cover floor should already force a week-1 order when a breach is imminent; if it didn't (all breach unavoidable within lead time), still surface BUY_NOW so the buyer acts. WAIT and HEDGE_LOCK both require empty order lines (F5-AC3).

**FIX-3 sanity check:**
- `WR-5.5-HC·RNC` — cover 18.2d < 21d floor, rising band. Floor forces earliest-feasible week-1 order; single dominant supplier (TATA_LP cheapest/shortest lead) → `w1_qty>0`, one supplier, `≥ 0.90×restore` → **row 3 BUY_NOW**, driver `COVER_BELOW_FLOOR`. ✓ (F5-AC1)
- `WR-8-MS·HSP` — comfortable cover, flat band. Flat band ⇒ timing cost-indifferent ⇒ `λ_hold` defers all buys ⇒ `w1_qty=0`; comfortable, `spread4 ≤ 0.08` ⇒ **row 6 WAIT**, driver `COVER_COMFORTABLE`, zero order lines. ✓ (F5-AC3)

### 2.3 Monte Carlo impact (500 seeded paths) vs baseline

**Path generation** (deterministic, `Generator(PCG64(42))`): for each path `p=1..500` draw one standard normal `z_p`; set `u_p = Φ(z_p)`. Price at week `t`:
```
mkt_p[t] = invCDF_t(u_p)
invCDF_t = piecewise-linear through (0.10→P10[t], 0.50→P50[t], 0.90→P90[t]), flat-extrapolated
```
One `z` per path (not per week) ⇒ paths are rank-correlated across weeks: a persistent commodity trend, no implausible weekly whipsaw, and each week's marginal exactly reproduces the E11 band quantiles. `supplier price on path p` scales as §3 with `mkt_p` replacing the P50 path.
**ponytail:** no mean-reversion / idiosyncratic term — the band already carries horizon-scaled uncertainty; upgrade to per-week shocks only if impact bands read implausibly tight.

**Baseline counterfactual (do-nothing / forced-later):** the same total delivered volume as the plan, but timed **just-in-time to the cover floor** (latest feasible arrival) instead of early. Per path `p`:
```
costDelta_p = plan_cost_p − baseline_cost_p
plan_cost_p     = Σ_{s,t} q[s,t] × supplier_price_p[s,t]
baseline_cost_p = same volume, JIT-scheduled, priced on path p
```
`expectedImpact = { costDeltaInr: median_p, costDeltaP10Inr: q10_p, costDeltaP90Inr: q90_p }` (negative = savings, matches PRD example). `wcDeltaInr` = plan spend in horizon; `coverAfterDays` = `cover[t*]` at the first post-arrival week. **ASSUMPTION A6** (baseline = JIT-to-floor same volume).

### 2.4 rationale JSON → source map (render from stored JSON only — pitfall)

| Field | Source |
|-------|--------|
| `inputs.coverDays` | `cover[0]` = `I0 / add[1]` |
| `inputs.minCoverDays` | policy |
| `inputs.band4w` | E11 band at h=4 |
| `inputs.spotInrMt` | latest market price |
| `inputs.spread` | `{s: offer_base[s]}` (§3) |
| `drivers[]` | derived flags → codes: cover<floor ⇒ `COVER_BELOW_FLOOR`; `rising` ⇒ `BAND_RISING`; `comfortable` & flat ⇒ `COVER_COMFORTABLE`; `spread4>HEDGE` ⇒ `BAND_WIDE`; step-2 relax ⇒ `WC_CAP_RELAXED` |
| `constraintsRespected[]` | active assumption literals in the winning solve → `MIN_COVER_{n}D`, `MAX_SUPPLIER_SHARE_{n}` |
| `order_lines` | `q[s,t]>0` → `{supplierCode, qtyMt, targetWeek: week0+t, estPriceInrMt: price[s,t]}` |
| `expected_impact` | §2.3 |

### 2.5 Solver timeout (F5-ERR3)

`max_time_in_seconds = 30`. If status ∉ {OPTIMAL, FEASIBLE} at the limit → mark that series `SOLVER_TIMEOUT` in run warnings, emit no recommendation for it, **run continues**. Demo problems solve in ms; this is a guard against a pathological input, not an expected path.

### 2.6 Solution checker (F5-AC2, unit)

After every solve, independently re-verify on the returned `q`: simulate `I[t]` for 12 weeks → assert `cover[t] ≥ min_cover_days` for all `t ≥ min lead` (and `u[t]` accounts for the rest); assert `100×(T_s+P_s) ≤ cap×(T_total+P_total)` ∀s. A violation is a build bug, not a widened assertion — "violations impossible by construction" means the checker fails the test, never softens the constraint.

---

## 7. ASSUMPTION register (PRD gaps resolved here — restate in T20/T21 summaries)

| ID | Assumption | If wrong |
|----|-----------|----------|
| A1 | Only model orders arriving within the 12-week horizon (`t+lead_wk ≤ 12`) | longer-horizon staging needs H>12 or explicit tail cost |
| A2 | Cover denominator = forward **4-week** mean daily demand, tail-clamped | change window → cover[t] and classifier thresholds shift |
| A3 | Trailing-90d share keyed on `po_date`, scoped material×plant | if delivery_date intended, swap the SQL predicate |
| A4 | Tiny `λ_hold` JIT tie-breaker for deterministic timing (not a real WC/holding model) | real holding cost → replace with policy-driven coefficient |
| A5 | Supplier offer delta = 0 in v1 (no schema field for "configured deltas") | add per-supplier delta column; drops into `offer_base[s]` |
| A6 | Impact baseline = same volume, JIT-to-floor timing, priced per simulated path | client may want spot-at-decision or budget baseline → §2.3 math changes |

**PRD ambiguities that stayed open (not resolved here):** none block T20/T21. `HEDGE_LOCK` UI visibility is PRD §14 TODO (human) — the classifier still *computes* it; T22/T24 decide whether to surface it.
