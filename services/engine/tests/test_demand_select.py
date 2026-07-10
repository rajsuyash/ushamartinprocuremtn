"""Winner-selection tests: synthetic (insufficient history, determinism) plus
the live-DB F3-AC1 gate over the full FIX-2 seeded dataset (T13)."""
import time

import pytest

from pdi_engine.data.readers import load_consumption
from pdi_engine.data.weekly import to_iso_weekly
from pdi_engine.demand.select import (
    INSUFFICIENT_HISTORY,
    InsufficientHistoryError,
    run_series,
)

from .demand_fixtures import make_seasonal_weekly_df

WAPE_GATE = 0.25  # F3-AC1: every series' winning WAPE must be <= this on demo data


def test_run_series_raises_insufficient_history_below_holdout_threshold():
    short_df = make_seasonal_weekly_df(n_weeks=15)

    with pytest.raises(InsufficientHistoryError, match=INSUFFICIENT_HISTORY):
        run_series(short_df)


def test_run_series_is_deterministic_across_invocations():
    df = make_seasonal_weekly_df(n_weeks=80)

    result_1 = run_series(df, horizon=12)
    result_2 = run_series(df, horizon=12)

    assert result_1["model"] == result_2["model"]
    assert result_1["backtest_wape"] == result_2["backtest_wape"]
    assert result_1["forecast"] == result_2["forecast"]


def test_run_series_forecast_has_expected_shape_and_finite_values():
    df = make_seasonal_weekly_df(n_weeks=80)

    result = run_series(df, horizon=12)

    assert result["model"] in {"seasonal_naive", "ets", "lightgbm"}
    assert len(result["forecast"]) == 12
    for point in result["forecast"]:
        assert set(point.keys()) == {"week", "p50_qty_mt"}
        assert point["p50_qty_mt"] == point["p50_qty_mt"]  # not NaN


def test_all_six_fix2_series_backtest_and_meet_wape_gate():
    """F3-AC1 (metrics side), live DB: every active material x plant series
    must get a winning model with backtest WAPE <= 0.25 on demo data."""
    consumption = load_consumption()
    weekly = to_iso_weekly(consumption)
    series_keys = weekly[["material_code", "plant_code"]].drop_duplicates()

    assert len(series_keys) == 6, (
        f"expected 6 seeded series, found {len(series_keys)}: "
        f"{series_keys.to_dict('records')}"
    )

    results = {}
    started = time.monotonic()
    for _, row in series_keys.iterrows():
        key = (row["material_code"], row["plant_code"])
        series_df = weekly[
            (weekly["material_code"] == key[0]) & (weekly["plant_code"] == key[1])
        ][["week", "qty_mt"]].reset_index(drop=True)
        results[key] = run_series(series_df)
    elapsed = time.monotonic() - started

    print(f"\n[T13] 6-series demand backtest wall time: {elapsed:.2f}s")
    for key, result in results.items():
        print(
            f"[T13] {key[0]} x {key[1]}: model={result['model']} "
            f"wape={result['backtest_wape']:.4f}"
        )

    misses = {
        key: result["backtest_wape"]
        for key, result in results.items()
        if result["backtest_wape"] > WAPE_GATE
    }
    assert not misses, f"F3-AC1 WAPE gate (<= {WAPE_GATE}) missed for: {misses}"
