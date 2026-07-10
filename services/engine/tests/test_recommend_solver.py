"""T21 unit tests (no DB) — CP-SAT solver, independent checker, classifier,
Monte Carlo, and the F5-ERR1/ERR3 degraded paths on fully synthetic inputs.

The synthetic builder lets each test pin exactly the cover/share/WC pressure it
needs. Two suppliers are the default because a single-supplier series can never
satisfy a <100% share cap (its share is always 100%).
"""
import copy
from datetime import date

import pytest

from pdi_engine.recommend import (
    check_solution,
    classify,
    compute_impact,
    recommend_series,
    solve_series,
)
from pdi_engine.recommend.inputs import (
    PolicyInputs,
    PriceBand,
    PricePaths,
    SeriesInputs,
    ShareDenominator,
    SupplierOffer,
)

DEFAULT_POLICY = PolicyInputs(
    min_cover_days=21,
    target_cover_days=35,
    max_supplier_share_pct=60.0,
    service_level_pct=95.0,
    wc_cap_inr=None,
)
TWO_SUPPLIERS = [
    SupplierOffer(supplier_code="S1", offer_base_inr=50000, lead_time_days=7, lead_weeks=1),
    SupplierOffer(supplier_code="S2", offer_base_inr=51000, lead_time_days=7, lead_weeks=1),
]


def make_inputs(
    *,
    on_hand: float,
    demand: list[float] | None = None,
    offers=None,
    denom=None,
    policy: PolicyInputs = DEFAULT_POLICY,
    spot: int = 54000,
    p50: list[int] | None = None,
    band4: PriceBand | None = None,
    open_po: list[float] | None = None,
) -> SeriesInputs:
    demand = demand or [100.0] * 12
    offers = offers or TWO_SUPPLIERS
    # Ample trailing history on both suppliers -> the 60% cap is non-binding for
    # the small week-1 buys here, so cost picks the single cheapest supplier
    # (mirrors FIX-3, where TATA's trailing volume gives it headroom). Tests that
    # want the cap to bite pass their own denom.
    denom = denom or ShareDenominator(per_supplier_mt={"S1": 5000.0, "S2": 5000.0}, total_mt=10000.0)
    p50 = p50 or [spot] * 12
    band4 = band4 or PriceBand(horizon_weeks=4, p10_inr_mt=53000, p50_inr_mt=54000, p90_inr_mt=55000)
    add1 = sum(demand[:4]) / 28
    return SeriesInputs(
        material_code="M",
        plant_code="P",
        grade_family="G",
        as_of=date(2026, 7, 6),
        on_hand_mt=on_hand,
        demand_p50_mt=demand,
        open_po_mt_by_week=open_po or [0.0] * 12,
        cover_days=on_hand / add1,
        avg_daily_demand_mt=add1,
        spot_inr_mt=spot,
        price_paths=PricePaths(p10=[spot] * 12, p50=p50, p90=[spot] * 12),
        band_4w=band4,
        offers=offers,
        share_denominator=denom,
        policy=policy,
    )


# --- solve + independent checker (F5-AC2) ----------------------------------- #
def test_solved_plan_passes_independent_checker():
    si = make_inputs(on_hand=150.0)  # 150 < 21d floor (~300) -> must buy
    art = solve_series(si)
    assert art.solved
    assert check_solution(si, art).ok


def test_checker_catches_a_deliberately_violated_plan():
    """Hostile: delete an order line from a valid plan -> cover must breach."""
    si = make_inputs(on_hand=150.0)
    art = solve_series(si)
    assert check_solution(si, art).ok
    bad = copy.deepcopy(art)
    del bad.q_mt[sorted(bad.q_mt)[0]]  # drop the earliest order
    result = check_solution(si, bad)
    assert not result.ok
    assert result.cover_violations  # names the breaching week(s)


def test_checker_catches_share_cap_violation():
    """A plan that over-concentrates one supplier vs its trailing share."""
    denom = ShareDenominator(per_supplier_mt={"S1": 900.0, "S2": 100.0}, total_mt=1000.0)
    si = make_inputs(on_hand=150.0, denom=denom)
    art = solve_series(si)
    assert check_solution(si, art).ok  # solver respects the cap
    bad = copy.deepcopy(art)
    bad.q_mt = {("S1", 1): 5000.0}  # 5900/6000 = 98% >> 60% cap
    result = check_solution(si, bad)
    assert not result.ok
    assert result.share_violations


# --- classifier BUY_NOW / WAIT sanity (deterministic) ----------------------- #
def test_breach_series_classifies_buy_now():
    si = make_inputs(on_hand=150.0)  # below floor
    rec = recommend_series(si)
    assert rec["play"] == "BUY_NOW"
    assert len(rec["orderLines"]) >= 1
    assert any(d["factor"] == "COVER_BELOW_FLOOR" for d in rec["rationale"]["drivers"])


def test_comfortable_series_classifies_wait_with_no_lines():
    # on_hand covers the whole horizon; flat band -> WAIT, zero lines.
    si = make_inputs(on_hand=1300.0, demand=[100.0] * 12)
    rec = recommend_series(si)
    assert rec["play"] == "WAIT"
    assert rec["orderLines"] == []
    assert any(d["factor"] == "COVER_COMFORTABLE" for d in rec["rationale"]["drivers"])


def test_hedge_lock_forces_empty_order_lines():
    """Comfortable + wide 4w band -> HEDGE_LOCK, which must carry no lines."""
    wide = PriceBand(horizon_weeks=4, p10_inr_mt=50000, p50_inr_mt=54000, p90_inr_mt=60000)
    si = make_inputs(on_hand=1300.0, band4=wide)  # spread4 = 10000/54000 = 0.185 > 0.08
    rec = recommend_series(si)
    assert rec["play"] == "HEDGE_LOCK"
    assert rec["orderLines"] == []


def test_split_suppliers_is_reachable():
    """Both suppliers lead-11 -> week 1 is the only order week, so the entire
    horizon buy lands there and the 60% cap forces a two-supplier split."""
    late = [
        SupplierOffer(supplier_code="S1", offer_base_inr=50000, lead_time_days=77, lead_weeks=11),
        SupplierOffer(supplier_code="S2", offer_base_inr=51000, lead_time_days=77, lead_weeks=11),
    ]
    empty = ShareDenominator(per_supplier_mt={}, total_mt=0.0)
    # on_hand carries weeks 1..11; the week-12 floor forces a split week-1 buy.
    si = make_inputs(on_hand=1150.0, offers=late, denom=empty)
    rec = recommend_series(si)
    assert rec["play"] == "SPLIT_SUPPLIERS"
    assert len({line["supplierCode"] for line in rec["orderLines"]}) == 2


def test_defensive_buy_now_synthesizes_a_restore_line():
    """Cover is below floor now but a large week-2 open PO restores it unaided,
    so the MILP buys nothing — the defensive BUY_NOW must still surface a line."""
    open_po = [0.0] * 12
    open_po[1] = 1300.0  # big arrival in week 2 holds the floor for the rest
    si = make_inputs(on_hand=250.0, open_po=open_po)  # cover 17.5d < 21d floor
    art = solve_series(si)
    assert art.q_mt == {}  # solver had no forced order
    rec = recommend_series(si)
    assert rec["play"] == "BUY_NOW"
    assert len(rec["orderLines"]) == 1
    assert rec["orderLines"][0]["qtyMt"] > 0


def test_lambda_hold_never_dominates_a_price_delta():
    """A4 strict-lexicographic invariant: the cost term (scaled by COST_SCALE)
    must outweigh the largest possible hold-term contribution for a single kg,
    so timing can never override even a 1-INR/MT price difference."""
    from pdi_engine.recommend.solver import COST_SCALE, HORIZON, LAMBDA_HOLD

    assert COST_SCALE * 1 > LAMBDA_HOLD * (HORIZON - 1)


# --- F5-ERR1: WC relaxation and NO_FEASIBLE_PLAN ---------------------------- #
def test_wc_cap_conflict_relaxes_to_partial_buy():
    # Floor forces spend the WC cap forbids; dropping WC (keep cover) solves.
    policy = PolicyInputs(
        min_cover_days=21, target_cover_days=35, max_supplier_share_pct=60.0,
        service_level_pct=95.0, wc_cap_inr=1_000_000,
    )
    si = make_inputs(on_hand=150.0, policy=policy)
    art = solve_series(si)
    assert art.solved and art.wc_relaxed
    rec = recommend_series(si)
    assert rec["play"] == "PARTIAL_BUY"
    assert any(d["factor"] == "WC_CAP_RELAXED" for d in rec["rationale"]["drivers"])


def test_infeasible_both_returns_no_feasible_plan_naming_constraints():
    # Only S1 deliverable (S2 lead 13w excluded); S1 pinned near the share cap;
    # a large late-week floor deficit exceeds what the cap permits -> infeasible
    # via the cover + share assumption literals, not a raw stockout.
    offers = [
        SupplierOffer(supplier_code="S1", offer_base_inr=50000, lead_time_days=7, lead_weeks=1),
        SupplierOffer(supplier_code="S2", offer_base_inr=50000, lead_time_days=91, lead_weeks=13),
    ]
    denom = ShareDenominator(per_supplier_mt={"S1": 1000.0, "S2": 1000.0}, total_mt=2000.0)
    policy = PolicyInputs(
        min_cover_days=21, target_cover_days=35, max_supplier_share_pct=60.0,
        service_level_pct=95.0, wc_cap_inr=500_000,
    )
    si = make_inputs(on_hand=3600.0, demand=[300.0] * 12, offers=offers, denom=denom, policy=policy)
    art = solve_series(si)
    assert art.status == "INFEASIBLE"
    rec = recommend_series(si)
    assert rec["status"] == "ERROR"
    assert rec["error"]["code"] == "NO_FEASIBLE_PLAN"
    assert "MIN_COVER_21D" in rec["error"]["bindingConstraints"]
    assert "MAX_SUPPLIER_SHARE_60" in rec["error"]["bindingConstraints"]


# --- F5-ERR3: solver timeout ------------------------------------------------ #
def test_tiny_time_budget_marks_solver_timeout_without_crashing():
    si = make_inputs(on_hand=150.0)
    art = solve_series(si, time_budget_s=1e-9)
    assert art.status == "TIMEOUT"
    rec = recommend_series(si, time_budget_s=1e-9)
    assert rec["status"] == "ERROR"
    assert rec["error"]["code"] == "SOLVER_TIMEOUT"


# --- Monte Carlo determinism ------------------------------------------------ #
def test_monte_carlo_impact_is_deterministic():
    si = make_inputs(on_hand=150.0)
    art = solve_series(si)
    orders = [(s, t, q) for (s, t), q in art.q_mt.items() if t == 1]
    assert compute_impact(si, art, orders) == compute_impact(si, art, orders)


def test_rising_band_yields_savings_of_correct_magnitude():
    """A rising P50 path -> buying now beats the JIT-later baseline, and the
    saving is INR-scale (not the 1000x-too-small kg-scaled bug)."""
    rising = [54000, 55000, 56000, 57000, 58000, 59000, 60000, 61000, 62000, 63000, 64000, 65000]
    si = make_inputs(on_hand=150.0, p50=rising)
    art = solve_series(si)
    orders = [(s, t, q) for (s, t), q in art.q_mt.items() if t == 1]
    impact = compute_impact(si, art, orders)
    qty = sum(q for _, _, q in orders)
    assert impact["costDeltaInr"] < 0  # early buy on a rising band is a saving
    assert impact["wcDeltaInr"] > 0
    # Magnitude sanity: the saving is roughly qty(MT) x (price drift over the
    # weeks the JIT baseline defers). ~1350 MT deferred a few weeks at ~1000
    # INR/MT/week is lakhs-to-crores of INR — must be within an order of
    # magnitude of qty x 1000/MT x 1 week, and nowhere near the /1000 bug value.
    per_mt_per_week_drift = 1000
    lower = qty * per_mt_per_week_drift  # >= one week of deferral
    assert abs(impact["costDeltaInr"]) > lower, (
        f"costDelta {impact['costDeltaInr']} too small — kg-scaling bug back?"
    )


def test_whole_solve_is_deterministic():
    si = make_inputs(on_hand=150.0)
    assert recommend_series(si) == recommend_series(si)
