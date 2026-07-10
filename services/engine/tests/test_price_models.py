"""Synthetic tests for the two price band models (T16)."""
from datetime import date, timedelta

import numpy as np

from pdi_engine.price.models import (
    QuantilePriceModel,
    RandomWalkBandModel,
    build_price_feature_row,
    repair_quantiles,
)

from .price_fixtures import make_price_weekly_df


def test_build_price_feature_row_uses_only_known_values_no_future_leakage():
    values = np.arange(30, dtype=float)  # 0..29, index i has value i
    weeks = np.array(
        [date(2023, 1, 2) + timedelta(weeks=i) for i in range(30)], dtype=object
    )
    origin_idx = 20  # "now" is index 20; forecasting some week beyond it
    target_week = weeks[25]

    row = build_price_feature_row(values, target_week, origin_idx)

    # lag_1 is the most recently known price (values[origin_idx] itself);
    # lag_k never reads past origin_idx.
    assert row["lag_1"] == values[origin_idx] == 20.0
    assert row["lag_2"] == values[origin_idx - 1] == 19.0
    assert row["lag_8"] == values[origin_idx - 7] == 13.0
    assert row["momentum_4"] == values[origin_idx] - values[origin_idx - 4] == 4.0
    assert row["week_of_year"] == target_week.isocalendar()[1]
    assert row["month"] == target_week.month


def test_build_price_feature_row_lags_are_nan_when_insufficient_history():
    values = np.array([100.0, 101.0])
    weeks = np.array([date(2023, 1, 2), date(2023, 1, 9)], dtype=object)

    row = build_price_feature_row(values, date(2023, 2, 6), origin_idx=1)

    assert row["lag_1"] == 101.0
    assert row["lag_2"] == 100.0
    assert np.isnan(row["lag_3"])
    assert np.isnan(row["momentum_4"])


def test_quantile_price_model_produces_finite_ordered_band():
    df = make_price_weekly_df(n_weeks=104)

    model = QuantilePriceModel(horizon_weeks=4).fit(df)
    p10, p50, p90 = model.predict()

    assert np.isfinite([p10, p50, p90]).all()


def test_quantile_price_model_is_deterministic_across_fits():
    df = make_price_weekly_df(n_weeks=104)

    band_1 = QuantilePriceModel(horizon_weeks=4).fit(df).predict()
    band_2 = QuantilePriceModel(horizon_weeks=4).fit(df).predict()

    assert band_1 == band_2


def test_quantile_price_model_falls_back_to_last_price_on_too_few_pairs():
    df = make_price_weekly_df(n_weeks=10)

    model = QuantilePriceModel(horizon_weeks=12).fit(df)  # 10 - 12 < 0 pairs
    p10, p50, p90 = model.predict()

    last_price = df["price_inr_mt"].iloc[-1]
    assert p10 == p50 == p90 == last_price


def test_random_walk_band_model_produces_ordered_band_around_last_price():
    df = make_price_weekly_df(n_weeks=60)

    p10, p50, p90 = RandomWalkBandModel(horizon_weeks=4).fit(df).predict()

    assert np.isfinite([p10, p50, p90]).all()
    assert p10 <= p50 <= p90


def test_repair_quantiles_sorts_crossed_input_and_flags_repaired():
    (p10, p50, p90), repaired = repair_quantiles(55_000, 53_000, 54_000)  # p10 > p50 > p90 crossed

    assert (p10, p50, p90) == (53_000, 54_000, 55_000)
    assert repaired is True


def test_repair_quantiles_leaves_already_sorted_input_unchanged():
    (p10, p50, p90), repaired = repair_quantiles(53_000, 54_000, 55_000)

    assert (p10, p50, p90) == (53_000, 54_000, 55_000)
    assert repaired is False
