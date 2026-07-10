"""T21 — independent solution checker (F5-AC2, spike §2.6).

Given a solved plan, re-simulate 12 weeks with plain Python arithmetic and
assert the cover floor holds at every achievable week and no supplier breaches
the trailing-90d share cap. This deliberately shares NO code path with the
CP-SAT model: "violations impossible by construction" means the checker fails
the test, never that the constraint is softened.

A violation is a build bug. The checker returns the concrete numbers so a test
can point at the exact week/supplier that broke.
"""
from __future__ import annotations

from dataclasses import dataclass, field

from .inputs import HORIZON_WEEKS, SeriesInputs, forward_avg_daily_demand
from .solver import SolveArtifacts

# The solver quantizes the floor to kg (`round(min_cover * add * 1000)`), which
# can sit up to 0.5 kg above the float floor the checker recomputes. 1 kg of
# slack absorbs that discretization without masking a real breach (which is
# always many MT — a dropped order line, not a rounding whisker).
_TOL_MT = 0.001  # 1 kg


@dataclass
class CheckResult:
    ok: bool
    cover_violations: list[dict] = field(default_factory=list)
    share_violations: list[dict] = field(default_factory=list)
    inv_mt: list[float] = field(default_factory=list)  # independently simulated


def check_solution(inputs: SeriesInputs, art: SolveArtifacts) -> CheckResult:
    """Re-derive inventory + cover + share from scratch and verify the plan.

    Everything below is recomputed from `inputs` (lead times, earliest arrival,
    the cover floor) — `art` is trusted only for the raw `q_mt` order quantities,
    so the check shares no derivation with the solver.
    """
    # Lead times + earliest achievable arrival, straight from inputs.
    lead = {o.supplier_code: o.lead_weeks for o in inputs.offers}
    active_leads = [o.lead_weeks for o in inputs.offers if 1 + o.lead_weeks <= HORIZON_WEEKS]
    earliest_arrival = 1 + min(active_leads) if active_leads else HORIZON_WEEKS + 1

    # Independent inventory simulation: I[t] = I[t-1] + openPO[t] + arrivals[t] - d[t]
    inv: list[float] = []
    on_hand = inputs.on_hand_mt
    for t in range(1, HORIZON_WEEKS + 1):
        arrivals = sum(
            qty
            for (s, ot), qty in art.q_mt.items()
            if ot + lead[s] == t
        )
        on_hand = on_hand + inputs.open_po_mt_by_week[t - 1] + arrivals - inputs.demand_p50_mt[t - 1]
        inv.append(on_hand)

    # Cover floor holds for every achievable week (t >= earliest_arrival).
    cover_violations: list[dict] = []
    min_cover = inputs.policy.min_cover_days
    for t in range(1, HORIZON_WEEKS + 1):
        if t < earliest_arrival:
            continue  # pre-arrival breach is unavoidable and un-actionable
        floor_mt = min_cover * forward_avg_daily_demand(inputs.demand_p50_mt, t)
        if inv[t - 1] + _TOL_MT < floor_mt:
            cover_violations.append(
                {
                    "week": t,
                    "invMt": round(inv[t - 1], 3),
                    "floorMt": round(floor_mt, 3),
                }
            )

    # Trailing-90d share incl. proposal <= cap, per supplier.
    share_violations: list[dict] = []
    cap = inputs.policy.max_supplier_share_pct
    t_total = inputs.share_denominator.total_mt
    p_by_supplier: dict[str, float] = {}
    for (s, _), qty in art.q_mt.items():
        p_by_supplier[s] = p_by_supplier.get(s, 0.0) + qty
    p_total = sum(p_by_supplier.values())
    denom = t_total + p_total
    if denom > 0:
        for s in art.suppliers:
            t_s = inputs.share_denominator.per_supplier_mt.get(s, 0.0)
            p_s = p_by_supplier.get(s, 0.0)
            # A supplier we do not buy from whose trailing share already exceeds
            # the cap is a pre-existing concentration the plan neither caused nor
            # can fix (its share only shrinks as the denominator grows). The
            # solver only constrains suppliers it can order from, so checking
            # this one would be a false F5-AC2 failure — skip it.
            if p_s == 0 and t_total > 0 and 100.0 * t_s / t_total > cap + 1e-6:
                continue
            share_pct = 100.0 * (t_s + p_s) / denom
            if share_pct > cap + 1e-6:
                share_violations.append(
                    {"supplier": s, "sharePct": round(share_pct, 4), "capPct": cap}
                )

    return CheckResult(
        ok=not cover_violations and not share_violations,
        cover_violations=cover_violations,
        share_violations=share_violations,
        inv_mt=inv,
    )
