"""Synthetic tests for the three demand forecasters (T13)."""
from datetime import date, timedelta

import numpy as np
import pandas as pd

from pdi_engine.demand.models import (
    ETSModel,
    LightGBMPointModel,
    SeasonalNaiveModel,
    build_feature_row,
)

from .demand_fixtures import make_seasonal_weekly_df


def test_seasonal_naive_reproduces_pure_seasonal_pattern():
    df = make_seasonal_weekly_df(n_weeks=104)
    train, holdout_actual = df.iloc[:-12], df.iloc[-12:]["qty_mt"].to_numpy()

    forecast = SeasonalNaiveModel().fit(train).predict(12)

    assert forecast.shape == (12,)
    np.testing.assert_allclose(forecast, holdout_actual, atol=1e-9)


def test_seasonal_naive_falls_back_to_last_value_when_series_shorter_than_period():
    df = make_seasonal_weekly_df(n_weeks=10, period=52)

    forecast = SeasonalNaiveModel().fit(df).predict(3)

    last_value = df["qty_mt"].iloc[-1]
    assert forecast.shape == (3,)
    np.testing.assert_allclose(forecast, [last_value] * 3)


def test_ets_produces_finite_forecast_on_long_series():
    df = make_seasonal_weekly_df(n_weeks=160)

    forecast = ETSModel().fit(df.iloc[:-12]).predict(12)

    assert forecast.shape == (12,)
    assert np.isfinite(forecast).all()


def test_ets_falls_back_gracefully_on_pathologically_short_series():
    df = make_seasonal_weekly_df(n_weeks=3)

    forecast = ETSModel().fit(df).predict(2)

    assert forecast.shape == (2,)
    assert np.isfinite(forecast).all()


def test_lightgbm_produces_finite_forecast():
    df = make_seasonal_weekly_df(n_weeks=104)

    forecast = LightGBMPointModel().fit(df.iloc[:-12]).predict(12)

    assert forecast.shape == (12,)
    assert np.isfinite(forecast).all()


def test_lightgbm_forecast_is_deterministic_across_fits():
    df = make_seasonal_weekly_df(n_weeks=104)
    train = df.iloc[:-12]

    forecast_1 = LightGBMPointModel().fit(train).predict(12)
    forecast_2 = LightGBMPointModel().fit(train).predict(12)

    np.testing.assert_array_equal(forecast_1, forecast_2)


def test_build_feature_row_uses_only_prior_values_no_future_leakage():
    values = np.arange(30, dtype=float)  # 0..29, index i has value i
    weeks = np.array(
        [date(2023, 1, 2) + timedelta(weeks=i) for i in range(30)], dtype=object
    )
    idx = 29  # final row: predicting values[29]

    row = build_feature_row(values, weeks, idx)

    # lags must come strictly from values[:idx], never values[idx] itself.
    assert row["lag_1"] == values[idx - 1] == 28.0
    assert row["lag_2"] == values[idx - 2] == 27.0
    assert row["lag_8"] == values[idx - 8] == 21.0
    # rolling means computed over the 4/8 values immediately before idx —
    # shifted, so idx's own value is excluded.
    assert row["roll_mean_4"] == values[idx - 4 : idx].mean() == np.mean([25, 26, 27, 28])
    assert row["roll_mean_8"] == values[idx - 8 : idx].mean()
    # lag_52 has no history that far back on a 30-point series -> NaN, not a
    # fabricated/leaked value.
    assert np.isnan(row["lag_52"])
