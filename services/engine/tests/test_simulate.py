"""F10 unit tests (no DB) — override application, forced-qty plan, deltas, and
determinism, on the same synthetic SeriesInputs builder as the T21 tests."""
import pytest
from pydantic import ValidationError

from pdi_engine.api.simulate import (
    SimulateOverrides,
    SimulateRequest,
    apply_overrides,
    compute_deltas,
    forced_plan,
)
from pdi_engine.recommend import recommend_series

from tests.test_recommend_solver import make_inputs


# --- apply_overrides is pure and targeted ------------------------------------ #
def test_apply_overrides_no_ops_returns_equal_inputs():
    si = make_inputs(on_hand=150.0)
    assert apply_overrides(si, SimulateOverrides()) == si


def test_apply_overrides_never_mutates_original():
    si = make_inputs(on_hand=150.0)
    before = si.model_copy(deep=True)
    apply_overrides(
        si,
        SimulateOverrides(
            min_cover_days=40, lead_time_buffer_days=7, price_shift_pct=10
        ),
    )
    assert si == before


def test_policy_override_applied():
    si = make_inputs(on_hand=150.0)
    out = apply_overrides(
        si, SimulateOverrides(min_cover_days=40, max_supplier_share_pct=80, wc_cap_inr=5)
    )
    assert out.policy.min_cover_days == 40
    assert out.policy.max_supplier_share_pct == 80
    assert out.policy.wc_cap_inr == 5
    assert out.policy.target_cover_days == si.policy.target_cover_days  # untouched


def test_lead_buffer_adjusts_days_and_weeks_clamped():
    si = make_inputs(on_hand=150.0)  # offers lead 7d / 1w
    out = apply_overrides(si, SimulateOverrides(lead_time_buffer_days=8))
    assert all(o.lead_time_days == 15 and o.lead_weeks == 3 for o in out.offers)
    out = apply_overrides(si, SimulateOverrides(lead_time_buffer_days=-14))
    assert all(o.lead_time_days == 0 and o.lead_weeks == 0 for o in out.offers)


def test_price_shift_scales_paths_and_band_not_spot():
    si = make_inputs(on_hand=150.0, spot=54000)
    out = apply_overrides(si, SimulateOverrides(price_shift_pct=10))
    assert out.spot_inr_mt == 54000
    assert out.price_paths.p50 == [int(round(v * 1.1)) for v in si.price_paths.p50]
    assert out.band_4w.p50_inr_mt == int(round(si.band_4w.p50_inr_mt * 1.1))


# --- overrides change the recommendation the way a buyer expects ------------- #
def test_raising_cover_floor_flips_wait_to_buy():
    si = make_inputs(on_hand=1300.0)  # comfortable -> WAIT at 21d floor
    assert recommend_series(si)["play"] == "WAIT"
    tweaked = apply_overrides(si, SimulateOverrides(min_cover_days=120))
    rec = recommend_series(tweaked)
    assert rec["play"] != "WAIT"
    assert rec["orderLines"]


def test_simulation_is_deterministic():
    si = make_inputs(on_hand=150.0)
    ov = SimulateOverrides(price_shift_pct=5, min_cover_days=30)
    a = recommend_series(apply_overrides(si, ov))
    b = recommend_series(apply_overrides(si, ov))
    assert a == b


# --- forced-qty plan ---------------------------------------------------------- #
def test_forced_plan_uses_cheapest_supplier_and_reports_impact():
    si = make_inputs(on_hand=150.0)
    out = forced_plan(si, 500.0)
    assert out["status"] == "PENDING"
    assert out["play"] == "BUY_NOW"
    [line] = out["orderLines"]
    assert line["supplierCode"] == "S1"  # 50000 < 51000
    assert line["qtyMt"] == 500.0
    assert out["expectedImpact"]["wcDeltaInr"] > 0
    assert "coverAfterDays" in out["expectedImpact"]
    assert out["constraintCheck"]["ok"] in (True, False)


def test_forced_plan_flags_cover_violation_honestly():
    # Tiny forced buy on a breaching series cannot restore the floor -> the
    # independent checker must report the violation, not hide it.
    si = make_inputs(on_hand=150.0)
    out = forced_plan(si, 1.0)
    assert not out["constraintCheck"]["ok"]
    assert out["constraintCheck"]["coverViolations"]


def test_forced_plan_no_deliverable_supplier_is_error():
    from pdi_engine.recommend.inputs import SupplierOffer

    slow = [
        SupplierOffer(
            supplier_code="SLOW", offer_base_inr=50000, lead_time_days=120, lead_weeks=18
        )
    ]
    si = make_inputs(on_hand=150.0, offers=slow)
    out = forced_plan(si, 100.0)
    assert out["status"] == "ERROR"
    assert out["error"]["code"] == "NO_IN_HORIZON_SUPPLIER"


# --- deltas ------------------------------------------------------------------- #
def test_compute_deltas():
    base = {"play": "WAIT", "expectedImpact": {"costDeltaInr": 0, "wcDeltaInr": 0, "coverAfterDays": 30.0}}
    sim = {"play": "BUY_NOW", "expectedImpact": {"costDeltaInr": -500, "wcDeltaInr": 100, "coverAfterDays": 42.5}}
    d = compute_deltas(base, sim)
    assert d == {
        "costDeltaInr": -500,
        "wcDeltaInr": 100,
        "coverAfterDays": 12.5,
        "playChanged": True,
    }
    assert compute_deltas({"expectedImpact": None}, sim) is None


# --- request validation -------------------------------------------------------- #
def test_request_rejects_bad_uuid_and_out_of_range_overrides():
    with pytest.raises(ValidationError):
        SimulateRequest(run_id="not-a-uuid", material_code="M", plant_code="P")
    with pytest.raises(ValidationError):
        SimulateOverrides(price_shift_pct=50)
    with pytest.raises(ValidationError):
        SimulateOverrides(forced_qty_mt=0)
