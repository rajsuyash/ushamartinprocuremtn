"""Per-grade_family band selection tests: synthetic (baseline fallback,
determinism) plus the live-DB F4-AC1 coverage gate over the FIX-2 seeded
grade families (T16)."""
from pdi_engine.data.readers import load_market_prices
from pdi_engine.data.weekly import weekly_prices
from pdi_engine.price.select import (
    BASELINE_FALLBACK,
    HORIZONS_WEEKS,
    MIN_WEEKLY_POINTS,
    run_grade_family,
)

from .price_fixtures import make_price_weekly_df

COVERAGE_LOWER = 0.70  # F4-AC1: demo-data coverage must land in [0.70, 0.90]
COVERAGE_UPPER = 0.90


def test_run_grade_family_falls_back_to_baseline_below_52_weekly_points():
    df = make_price_weekly_df(n_weeks=MIN_WEEKLY_POINTS - 1)

    result = run_grade_family(df)

    assert result["baseline_fallback"] is True


def test_run_grade_family_uses_quantile_model_at_or_above_52_weekly_points():
    df = make_price_weekly_df(n_weeks=MIN_WEEKLY_POINTS)

    result = run_grade_family(df)

    assert result["baseline_fallback"] is False


def test_run_grade_family_is_deterministic_across_invocations():
    df = make_price_weekly_df(n_weeks=80)

    result_1 = run_grade_family(df)
    result_2 = run_grade_family(df)

    assert result_1 == result_2


def test_run_grade_family_bands_cover_every_horizon_and_are_monotonic():
    df = make_price_weekly_df(n_weeks=80)

    result = run_grade_family(df)

    horizons_seen = {band["horizon_weeks"] for band in result["bands"]}
    assert horizons_seen == set(HORIZONS_WEEKS)
    for band in result["bands"]:
        assert band["p10_inr_mt"] <= band["p50_inr_mt"] <= band["p90_inr_mt"]
        assert isinstance(band["p10_inr_mt"], int)
        assert isinstance(band["p50_inr_mt"], int)
        assert isinstance(band["p90_inr_mt"], int)


def test_both_fix2_grade_families_meet_f4_ac1_coverage_gate():
    """F4-AC1 (model side), live DB: bands exist for every grade_family x
    horizon, p10<=p50<=p90 on every row, coverage in [0.70, 0.90]."""
    prices = load_market_prices()
    grade_families = sorted(prices["grade_family"].unique())

    assert len(grade_families) == 2, (
        f"expected 2 seeded grade families, found {len(grade_families)}: {grade_families}"
    )

    misses = {}
    for grade_family in grade_families:
        weekly = weekly_prices(prices, grade_family=grade_family)
        result = run_grade_family(weekly)

        print(
            f"\n[T16] {grade_family}: baseline_fallback={result['baseline_fallback']} "
            f"quantile_repaired_count={result['quantile_repaired_count']}"
        )
        for band in result["bands"]:
            print(
                f"[T16] {grade_family} h={band['horizon_weeks']}w: "
                f"p10={band['p10_inr_mt']} p50={band['p50_inr_mt']} p90={band['p90_inr_mt']} "
                f"coverage={band['coverage_8090']:.3f} pinball={band['pinball']:.1f}"
            )
            assert band["p10_inr_mt"] <= band["p50_inr_mt"] <= band["p90_inr_mt"]
            if not (COVERAGE_LOWER <= band["coverage_8090"] <= COVERAGE_UPPER):
                misses[(grade_family, band["horizon_weeks"])] = band["coverage_8090"]

    assert not misses, f"F4-AC1 coverage gate ([{COVERAGE_LOWER}, {COVERAGE_UPPER}]) missed for: {misses}"
