"""T21 — CP-SAT MILP solver for the F5 play recommendation (spike Q1/Q2.1).

Per material x plant, minimize expected landed cost over a 12-week horizon
subject to a cover floor, a trailing-90d supplier-share cap, and an optional
working-capital cap. CP-SAT is integer-only, so all MT quantities are scaled to
**kilograms** (`q_kg = round(MT * 1000)`) and prices stay INR/MT; the objective
is therefore in units of `kg * INR/MT = 1000 * INR` and is unscaled by /1000 at
report time.

Determinism is contractual (F5-AC1): `random_seed = 42`, `num_search_workers =
1`. The 30s wall-clock budget is an F5-ERR3 safety valve — demo problems solve
in ms and reach OPTIMAL; a genuine timeout is a degraded path (`SOLVER_TIMEOUT`)
that never feeds a deterministic AC.

Relaxation order is fixed by PRD F5-ERR1: solve with the WC cap first; on
INFEASIBLE drop only the WC cap (keep cover floor + share cap); if still
infeasible, name the binding constraints via
`sufficient_assumptions_for_infeasibility()`.

Simplification vs spike §1.4: the spike models pre-arrival breach with a
penalized slack `u[t]`. Weeks before `earliest_arrival = 1 + min_lead` cannot be
lifted by any order (arrivals land too late) and their breach is fully
determined by I0/openPO/demand — independent of the decision vars. So instead of
a no-op penalty we simply do not impose the floor there (only `I[t] >= 0`), which
is equivalent and drops the slack machinery.
"""
from __future__ import annotations

from dataclasses import dataclass, field

from ortools.sat.python import cp_model

from .inputs import SeriesInputs, forward_avg_daily_demand

# Determinism / budget (spike §1.9)
SOLVER_SEED = 42  # == LGBM_SEED
NUM_WORKERS = 1
DEFAULT_TIME_BUDGET_S = 30.0

KG = 1000  # MT -> kg scaling
HORIZON = 12
# Strict lexicographic ordering (spike A4): cost is scaled by HORIZON so that the
# smallest possible cost delta (1 INR/MT on one kg = HORIZON in the scaled
# objective) always beats the largest hold-term contribution for that same kg
# (weight 12-t <= HORIZON-1). The hold term therefore only ever breaks ties
# between plans of *equal* cost — it can never override a 1-INR/MT price
# difference. Asserted in test_lambda_hold_never_dominates_price_delta.
COST_SCALE = HORIZON
LAMBDA_HOLD = 1  # tiny JIT tie-breaker; strictly < COST_SCALE / (HORIZON-1)
QMAX_DEMAND_MULT = 3  # per-var order ceiling = 3 x max weekly demand x 12 weeks

# Assumption-literal -> constraint name mapping is built per-solve (needs policy).
_STATUS_SOLVED = {cp_model.OPTIMAL, cp_model.FEASIBLE}


@dataclass
class SolveArtifacts:
    """Everything the classifier / checker / Monte Carlo need from one solve.

    Status is one of OPTIMAL / FEASIBLE / TIMEOUT / INFEASIBLE. On INFEASIBLE,
    `binding_constraints` names the minimal conflicting constraint set.
    """

    status: str
    suppliers: list[str]
    lead_wk: dict[str, int]
    offer_base: dict[str, int]
    price_st: dict[tuple[str, int], int]  # order-week t price, INR/MT
    q_mt: dict[tuple[str, int], float] = field(default_factory=dict)
    inv_mt: list[float] = field(default_factory=list)  # I[1..12]
    arrivals_mt: list[float] = field(default_factory=list)  # new_arr[1..12]
    floor_mt: list[float] = field(default_factory=list)  # min_cover_days * add[t]
    add_daily_mt: list[float] = field(default_factory=list)  # avg daily demand[t]
    earliest_arrival: int = HORIZON + 1
    wc_relaxed: bool = False
    binding_constraints: list[str] = field(default_factory=list)

    @property
    def solved(self) -> bool:
        return self.status in ("OPTIMAL", "FEASIBLE")


def _price(offer_base: int, p50_path_t: int, spot: int) -> int:
    """Supplier order-week price: offer drifted by the band median (spike §3)."""
    return int(round(offer_base * p50_path_t / spot))


def solve_series(
    inputs: SeriesInputs, time_budget_s: float = DEFAULT_TIME_BUDGET_S
) -> SolveArtifacts:
    """Solve one series, applying the F5-ERR1 relaxation order internally."""
    suppliers = [o.supplier_code for o in inputs.offers]
    lead_wk = {o.supplier_code: o.lead_weeks for o in inputs.offers}
    offer_base = {o.supplier_code: o.offer_base_inr for o in inputs.offers}
    spot = inputs.spot_inr_mt
    p50 = inputs.price_paths.p50  # len 12, index t-1

    price_st = {
        (s, t): _price(offer_base[s], p50[t - 1], spot)
        for s in suppliers
        for t in range(1, HORIZON + 1)
    }

    # Only suppliers whose earliest order (week 1) still arrives in-horizon.
    active = [s for s in suppliers if 1 + lead_wk[s] <= HORIZON]
    if not active:
        # No supplier can deliver within the horizon at all.
        return SolveArtifacts(
            status="INFEASIBLE",
            suppliers=suppliers,
            lead_wk=lead_wk,
            offer_base=offer_base,
            price_st=price_st,
            binding_constraints=["NO_IN_HORIZON_SUPPLIER"],
        )

    earliest_arrival = 1 + min(lead_wk[s] for s in active)

    # Constants (kg).
    i0_kg = round(inputs.on_hand_mt * KG)
    d_kg = [round(v * KG) for v in inputs.demand_p50_mt]
    openpo_kg = [round(v * KG) for v in inputs.open_po_mt_by_week]
    add_daily = [forward_avg_daily_demand(inputs.demand_p50_mt, t) for t in range(1, HORIZON + 1)]
    floor_kg = [round(inputs.policy.min_cover_days * add_daily[t - 1] * KG) for t in range(1, HORIZON + 1)]
    q_max = round(QMAX_DEMAND_MULT * max(inputs.demand_p50_mt) * HORIZON * KG)
    inv_max = i0_kg + sum(openpo_kg) + q_max * len(active) * HORIZON

    model = cp_model.CpModel()

    # Order vars: q[s,t] placed week t, arriving t+lead (A1: only in-horizon).
    q: dict[tuple[str, int], cp_model.IntVar] = {}
    for s in active:
        for t in range(1, HORIZON + 1):
            if t + lead_wk[s] <= HORIZON:
                q[(s, t)] = model.new_int_var(0, q_max, f"q_{s}_{t}")

    # Inventory balance.
    inv = [model.new_int_var(0, inv_max, f"I_{t}") for t in range(1, HORIZON + 1)]
    arr_expr: list = []
    for t in range(1, HORIZON + 1):
        new_arr = [
            q[(s, t - lead_wk[s])]
            for s in active
            if (s, t - lead_wk[s]) in q and t - lead_wk[s] >= 1
        ]
        arr_expr.append(sum(new_arr) if new_arr else 0)
        prev = i0_kg if t == 1 else inv[t - 2]
        model.add(inv[t - 1] == prev + openpo_kg[t - 1] + arr_expr[-1] - d_kg[t - 1])

    # Assumption literals (spike Q2.1).
    a_cover = model.new_bool_var("A_cover")
    a_share = model.new_bool_var("A_share")
    a_wc = model.new_bool_var("A_wc")
    lit_name = {
        a_cover.index: f"MIN_COVER_{inputs.policy.min_cover_days}D",
        a_share.index: f"MAX_SUPPLIER_SHARE_{int(inputs.policy.max_supplier_share_pct)}",
        a_wc.index: "WC_CAP",
    }

    # Hard cover floor from earliest achievable arrival onward.
    for t in range(earliest_arrival, HORIZON + 1):
        model.add(inv[t - 1] >= floor_kg[t - 1]).only_enforce_if(a_cover)

    # Trailing-90d share cap incl. proposal, per supplier (spike §1.5).
    cap100 = round(inputs.policy.max_supplier_share_pct * 100)
    t_total_kg = round(inputs.share_denominator.total_mt * KG)
    p_total = sum(q.values())
    for s in active:
        t_s_kg = round(inputs.share_denominator.per_supplier_mt.get(s, 0.0) * KG)
        p_s = sum(v for (sup, _), v in q.items() if sup == s)
        # 100*(T_s+P_s) <= cap*(T_total+P_total)  (x100 to clear a fractional cap)
        model.add(
            10000 * (t_s_kg + p_s) <= cap100 * (t_total_kg + p_total)
        ).only_enforce_if(a_share)

    # Optional working-capital cap (spike §1.7).
    has_wc = inputs.policy.wc_cap_inr is not None
    if has_wc:
        spend = sum(q[(s, t)] * price_st[(s, t)] for (s, t) in q)
        model.add(spend <= inputs.policy.wc_cap_inr * KG).only_enforce_if(a_wc)

    # Objective: landed cost (lexicographically primary) + tiny JIT hold
    # tie-breaker (spike §1.8, A4).
    cost = sum(q[(s, t)] * price_st[(s, t)] for (s, t) in q)
    hold = sum(q[(s, t)] * (HORIZON - t) for (s, t) in q)
    model.minimize(COST_SCALE * cost + LAMBDA_HOLD * hold)

    solver = cp_model.CpSolver()
    solver.parameters.random_seed = SOLVER_SEED
    solver.parameters.num_search_workers = NUM_WORKERS
    solver.parameters.max_time_in_seconds = time_budget_s

    def _extract(status: int, wc_relaxed: bool) -> SolveArtifacts:
        q_mt = {
            (s, t): solver.value(var) / KG
            for (s, t), var in q.items()
            if solver.value(var) > 0
        }
        inv_mt = [solver.value(v) / KG for v in inv]
        arrivals_mt = [
            (solver.value(e) / KG if not isinstance(e, int) else 0.0) for e in arr_expr
        ]
        return SolveArtifacts(
            status="OPTIMAL" if status == cp_model.OPTIMAL else "FEASIBLE",
            suppliers=suppliers,
            lead_wk=lead_wk,
            offer_base=offer_base,
            price_st=price_st,
            q_mt=q_mt,
            inv_mt=inv_mt,
            arrivals_mt=arrivals_mt,
            floor_mt=[f / KG for f in floor_kg],
            add_daily_mt=add_daily,
            earliest_arrival=earliest_arrival,
            wc_relaxed=wc_relaxed,
        )

    # Step 1 — all constraints active.
    model.clear_assumptions()
    model.add_assumptions([a_cover, a_share] + ([a_wc] if has_wc else []))
    status = solver.solve(model)
    if status in _STATUS_SOLVED:
        return _extract(status, wc_relaxed=False)

    # Step 2 — drop the WC cap only (F5-ERR1), keep cover + share.
    if status == cp_model.INFEASIBLE and has_wc:
        model.clear_assumptions()
        model.add_assumptions([a_cover, a_share])
        status = solver.solve(model)
        if status in _STATUS_SOLVED:
            return _extract(status, wc_relaxed=True)

    # A malformed model is a build bug, not a resource limit — surface it as its
    # own code rather than masquerading as a timeout.
    if status == cp_model.MODEL_INVALID:
        return SolveArtifacts(
            status="MODEL_INVALID",
            suppliers=suppliers,
            lead_wk=lead_wk,
            offer_base=offer_base,
            price_st=price_st,
        )

    # Timeout / unknown — degraded path, run continues (F5-ERR3).
    if status not in (cp_model.INFEASIBLE,):
        return SolveArtifacts(
            status="TIMEOUT",
            suppliers=suppliers,
            lead_wk=lead_wk,
            offer_base=offer_base,
            price_st=price_st,
        )

    # Still infeasible — name the binding constraints (spike Q2.1).
    core = solver.sufficient_assumptions_for_infeasibility()
    binding = sorted({lit_name.get(idx) for idx in core if lit_name.get(idx)})
    return SolveArtifacts(
        status="INFEASIBLE",
        suppliers=suppliers,
        lead_wk=lead_wk,
        offer_base=offer_base,
        price_st=price_st,
        binding_constraints=binding or ["INFEASIBLE"],
    )
