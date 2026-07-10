"""Pure-function unit tests for T20 recommend input assembly (no DB).

Covers: forward-window cover denominator (spike A2), open-PO delivery-week
bucketing (pitfall: arrivals land in their delivery week, not week 0), and the
3-horizon -> 12-week price interpolation (spike §3) with exact synthetic values.
"""
from datetime import date

import pytest

from pdi_engine.recommend.inputs import (
    HORIZON_WEEKS,
    PriceBand,
    bucket_open_pos_by_week,
    build_price_paths,
    compute_cover,
    forward_avg_daily_demand,
    interpolate_path,
)


# --- cover denominator (A2) ------------------------------------------------- #
def test_forward_avg_daily_demand_first_window():
    demand = [350.0, 350.0, 350.0, 350.0] + [0.0] * 8
    # (350*4) / (7*4) = 1400/28 = 50 MT/day
    assert forward_avg_daily_demand(demand, t=1) == pytest.approx(50.0)


def test_forward_avg_daily_demand_tail_clamped():
    demand = [70.0] * HORIZON_WEEKS
    # t=11 clamps to weeks 11..12 (2 weeks): 140/(7*2) = 10
    assert forward_avg_daily_demand(demand, t=11) == pytest.approx(10.0)
    # t=12 clamps to the last single week: 70/7 = 10
    assert forward_avg_daily_demand(demand, t=12) == pytest.approx(10.0)


def test_compute_cover_exact():
    demand = [350.0] * HORIZON_WEEKS
    cover = compute_cover(on_hand_mt=700.0, demand_p50_mt=demand)
    # add1 = 1400/28 = 50; cover = 700/50 = 14 days
    assert cover.avg_daily_demand_mt == pytest.approx(50.0)
    assert cover.cover_days == pytest.approx(14.0)
    # week-0 reported cover is on-hand only; open POs attached separately
    assert cover.open_po_mt_by_week == [0.0] * HORIZON_WEEKS


# --- open-PO delivery-week bucketing (pitfall) ------------------------------ #
def test_open_po_lands_in_delivery_week_not_week_zero():
    as_of = date(2026, 7, 6)  # a Monday
    # delivery three weeks out (2026-07-27 is the Monday of week 3)
    weeks = bucket_open_pos_by_week([(date(2026, 7, 27), 500.0)], as_of)
    assert weeks[2] == pytest.approx(500.0)  # week 3 -> index 2
    assert weeks[0] == 0.0  # NOT week 0
    assert sum(weeks) == pytest.approx(500.0)


def test_open_po_same_week_folds_to_week_one():
    as_of = date(2026, 7, 6)
    weeks = bucket_open_pos_by_week([(date(2026, 7, 9), 200.0)], as_of)
    assert weeks[0] == pytest.approx(200.0)  # committed steel not lost


def test_open_po_beyond_horizon_dropped():
    as_of = date(2026, 7, 6)
    # 13 weeks out -> outside the 12-week horizon (A1)
    weeks = bucket_open_pos_by_week([(date(2026, 10, 5), 999.0)], as_of)
    assert sum(weeks) == 0.0


def test_open_po_multiple_accumulate_per_week():
    as_of = date(2026, 7, 6)
    weeks = bucket_open_pos_by_week(
        [(date(2026, 7, 27), 100.0), (date(2026, 7, 27), 50.0)], as_of
    )
    assert weeks[2] == pytest.approx(150.0)


# --- price interpolation (spike §3) ----------------------------------------- #
def test_interpolate_path_exact_synthetic():
    path = interpolate_path(spot=54000, anchors={1: 54200, 4: 54800, 12: 56000})
    expected = [
        54200,  # t=1 anchor
        54400,  # t=2: +200 (1/3 of 600)
        54600,  # t=3: +400 (2/3 of 600)
        54800,  # t=4 anchor
        54950,  # t=5: +150 (1/8 of 1200)
        55100,  # t=6
        55250,  # t=7
        55400,  # t=8
        55550,  # t=9
        55700,  # t=10
        55850,  # t=11
        56000,  # t=12 anchor
    ]
    assert path == expected


def test_build_price_paths_preserves_band_order():
    bands = {
        1: PriceBand(horizon_weeks=1, p10_inr_mt=53000, p50_inr_mt=54000, p90_inr_mt=55000),
        4: PriceBand(horizon_weeks=4, p10_inr_mt=52500, p50_inr_mt=54500, p90_inr_mt=56500),
        12: PriceBand(horizon_weeks=12, p10_inr_mt=52000, p50_inr_mt=55000, p90_inr_mt=58000),
    }
    paths = build_price_paths(spot=54000, bands=bands)
    assert len(paths.p10) == len(paths.p50) == len(paths.p90) == HORIZON_WEEKS
    # p10 <= p50 <= p90 must hold at every interpolated week
    for lo, mid, hi in zip(paths.p10, paths.p50, paths.p90, strict=True):
        assert lo <= mid <= hi
