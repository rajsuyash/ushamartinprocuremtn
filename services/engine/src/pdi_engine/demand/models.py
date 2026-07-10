"""Three demand forecasters sharing one interface: fit(train_df) -> predict(horizon) -> np.ndarray.

train_df: DataFrame(week: date, qty_mt: float) for a single material x plant
series, sorted ascending, gapless (T12's `weekly.to_iso_weekly` output).

All feature/lag construction shifts before rolling — a row for target index
`i` only ever reads `values[:i]`, never `values[i]` itself. This is what
keeps LightGBM's per-fold training leakage-free (PRD F3 pitfall) and is
exercised directly in tests via `build_feature_row`.
"""
from __future__ import annotations

import warnings
from datetime import timedelta

import lightgbm as lgb
import numpy as np
import pandas as pd
from statsmodels.tsa.holtwinters import ExponentialSmoothing

SEASONAL_PERIOD_WEEKS = 52
LGBM_SEED = 42

FEATURE_COLUMNS = [
    "lag_1", "lag_2", "lag_3", "lag_4", "lag_5", "lag_6", "lag_7", "lag_8",
    "lag_52", "roll_mean_4", "roll_mean_8", "week_of_year", "month",
]


class SeasonalNaiveModel:
    """Forecast = value observed 52 weeks before the target week.

    Fallback: last observed value when the series is shorter than 52 weeks
    (no 52-weeks-prior value exists yet).
    """

    def fit(self, train_df: pd.DataFrame) -> "SeasonalNaiveModel":
        self._values = train_df["qty_mt"].to_numpy(dtype=float)
        return self

    def predict(self, horizon_weeks: int) -> np.ndarray:
        n = len(self._values)
        out = np.empty(horizon_weeks, dtype=float)
        for h in range(horizon_weeks):
            source_idx = n + h - SEASONAL_PERIOD_WEEKS
            out[h] = self._values[source_idx] if 0 <= source_idx < n else self._values[-1]
        return out


class ETSModel:
    """statsmodels ExponentialSmoothing: additive trend+seasonal once >=104
    points (two full 52-week cycles) are available, trend-only below that.
    Convergence warnings are expected on short synthetic folds and are
    suppressed rather than surfaced as failures; an outright fit exception
    falls back to a flat mean forecast.

    # ponytail: flat-mean fallback only fires on pathological short training
    # windows (a handful of points); FIX-2 series are 157 weeks so this path
    # is exercised by synthetic tests, not the live-DB gate.
    """

    def fit(self, train_df: pd.DataFrame) -> "ETSModel":
        values = train_df["qty_mt"].to_numpy(dtype=float)
        n = len(values)
        self._fallback_value = float(values.mean()) if n else 0.0
        self._fitted = None
        with warnings.catch_warnings():
            warnings.simplefilter("ignore")
            try:
                if n >= 2 * SEASONAL_PERIOD_WEEKS:
                    model = ExponentialSmoothing(
                        values,
                        trend="add",
                        seasonal="add",
                        seasonal_periods=SEASONAL_PERIOD_WEEKS,
                        initialization_method="estimated",
                    )
                elif n >= 10:
                    model = ExponentialSmoothing(
                        values, trend="add", seasonal=None, initialization_method="estimated"
                    )
                else:
                    model = ExponentialSmoothing(
                        values, trend=None, seasonal=None, initialization_method="estimated"
                    )
                self._fitted = model.fit(optimized=True)
            except Exception:
                self._fitted = None
        return self

    def predict(self, horizon_weeks: int) -> np.ndarray:
        if self._fitted is None:
            return np.full(horizon_weeks, self._fallback_value, dtype=float)
        return np.asarray(self._fitted.forecast(horizon_weeks), dtype=float)


def build_feature_row(values: np.ndarray, weeks: np.ndarray, idx: int) -> dict:
    """Feature row for predicting values[idx] — reads only values[:idx].

    `weeks[idx]` supplies the calendar features (week-of-year, month) for the
    target being predicted; it is never used to read a value.
    """

    def lag(k: int) -> float:
        j = idx - k
        return float(values[j]) if j >= 0 else np.nan

    past = values[:idx]
    row = {f"lag_{k}": lag(k) for k in range(1, 9)}
    row["lag_52"] = lag(SEASONAL_PERIOD_WEEKS)
    row["roll_mean_4"] = float(past[-4:].mean()) if len(past) >= 1 else np.nan
    row["roll_mean_8"] = float(past[-8:].mean()) if len(past) >= 1 else np.nan
    target_week = weeks[idx]
    row["week_of_year"] = int(target_week.isocalendar()[1])
    row["month"] = int(target_week.month)
    return row


class LightGBMPointModel:
    """LGBMRegressor, deterministic single-threaded config, recursive
    multi-step forecast. Missing lags on short history are left as NaN —
    LightGBM's native missing-value handling routes them without fabricating
    values or dropping rows.
    """

    def fit(self, train_df: pd.DataFrame) -> "LightGBMPointModel":
        train_df = train_df.reset_index(drop=True)
        values = train_df["qty_mt"].to_numpy(dtype=float)
        weeks = train_df["week"].to_numpy()
        n = len(values)

        rows = [build_feature_row(values, weeks, i) for i in range(n)]
        X = pd.DataFrame(rows, columns=FEATURE_COLUMNS)
        y = values

        # ponytail: native Dataset/train API instead of the LGBMRegressor
        # sklearn wrapper — the wrapper hard-requires scikit-learn to be
        # installed (it isn't, and the task explicitly prefers not to add
        # it); lgb.train gives the same deterministic config with one fewer
        # dependency.
        train_set = lgb.Dataset(X, label=y, free_raw_data=False)
        params = {
            "objective": "regression",
            "deterministic": True,
            "num_threads": 1,
            "seed": LGBM_SEED,
            "force_row_wise": True,
            "min_child_samples": 5,
            "verbosity": -1,
        }
        self._model = lgb.train(params, train_set, num_boost_round=200)
        self._values: list[float] = values.tolist()
        self._weeks: list = list(weeks)
        return self

    def predict(self, horizon_weeks: int) -> np.ndarray:
        values = list(self._values)
        weeks = list(self._weeks)
        out = np.empty(horizon_weeks, dtype=float)
        for h in range(horizon_weeks):
            target_week = weeks[-1] + timedelta(weeks=1)
            idx = len(values)
            row = build_feature_row(np.asarray(values), np.asarray(weeks + [target_week]), idx)
            X = pd.DataFrame([row], columns=FEATURE_COLUMNS)
            pred = float(self._model.predict(X)[0])
            out[h] = pred
            values.append(pred)
            weeks.append(target_week)
        return out
