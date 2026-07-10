"""Two band models sharing one interface: fit(train_df) -> predict() -> (p10, p50, p90).

train_df: DataFrame(week: date, price_inr_mt: float) for a single grade_family
series, sorted ascending. Direct multi-step forecasting: a model is built for
one fixed `horizon_weeks` and predicts exactly that many weeks past the last
observed price — never recursively, so quantile crossing isn't amplified by a
chain of point predictions feeding each other.

Feature rows read only `values[:origin_idx + 1]` — the prices known "now" —
which is what keeps a fold's training leak-free at fold boundaries (PRD F4
pitfall), exercised directly in tests via `build_price_feature_row`.
"""
from __future__ import annotations

import math
from datetime import date, timedelta

import lightgbm as lgb
import numpy as np
import pandas as pd

from ..demand.models import LGBM_SEED

QUANTILE_ALPHAS = (0.1, 0.5, 0.9)
MIN_TRAIN_PAIRS = 8  # below this, direct (origin, target) pairs are too sparse to fit

FEATURE_COLUMNS = [
    "lag_1", "lag_2", "lag_3", "lag_4", "lag_5", "lag_6", "lag_7", "lag_8",
    "momentum_4", "roll_vol_8", "week_of_year", "month",
]


def build_price_feature_row(values: np.ndarray, target_week: date, origin_idx: int) -> dict:
    """Feature row for a direct forecast landing on `target_week`, using only
    prices known as of `origin_idx` ("now") — `values[origin_idx]` is the most
    recently observed price, never anything past it.
    """

    def lag(k: int) -> float:
        j = origin_idx - (k - 1)
        return float(values[j]) if j >= 0 else np.nan

    row = {f"lag_{k}": lag(k) for k in range(1, 9)}

    if origin_idx - 4 >= 0:
        row["momentum_4"] = float(values[origin_idx] - values[origin_idx - 4])
    else:
        row["momentum_4"] = np.nan

    known = values[: origin_idx + 1]
    with np.errstate(divide="ignore", invalid="ignore"):
        returns = np.diff(known) / known[:-1] if len(known) >= 2 else np.array([])
    returns = returns[np.isfinite(returns)]
    row["roll_vol_8"] = float(np.std(returns[-8:])) if len(returns) >= 2 else np.nan

    row["week_of_year"] = int(target_week.isocalendar()[1])
    row["month"] = int(target_week.month)
    return row


class QuantilePriceModel:
    """Three LGBMRegressors (alpha 0.1/0.5/0.9), deterministic single-threaded
    config, direct `horizon_weeks`-ahead quantile forecast.

    Falls back to a flat repeat of the last known price when the training
    window is too short to build any (origin, target) pair — this only fires
    on pathologically small backtest folds, never on the full-series live fit
    once F4-ERR1's 52-week gate has already routed short series to the
    baseline model instead.
    """

    def __init__(self, horizon_weeks: int) -> None:
        self.horizon_weeks = horizon_weeks

    def fit(self, train_df: pd.DataFrame) -> "QuantilePriceModel":
        train_df = train_df.sort_values("week").reset_index(drop=True)
        values = train_df["price_inr_mt"].to_numpy(dtype=float)
        weeks = train_df["week"].to_numpy()
        n = len(values)
        h = self.horizon_weeks

        self._last_values = values
        self._last_weeks = weeks
        self._models: dict[float, lgb.Booster] | None = None

        n_pairs = n - h
        if n_pairs < MIN_TRAIN_PAIRS:
            self._fallback_price = float(values[-1]) if n else 0.0
            return self

        # Target is the horizon-ahead *return* relative to the origin's own
        # price, not the absolute level: a slow-moving series makes lag_1
        # almost equal to the level target, so a level-target quantile model
        # collapses to a near-flat in-sample fit and understates real
        # forward uncertainty. Modeling the return lets the quantile spread
        # reflect the series' actual weekly volatility.
        rows, targets = [], []
        for origin_idx in range(n_pairs):
            target_idx = origin_idx + h
            rows.append(build_price_feature_row(values, weeks[target_idx], origin_idx))
            targets.append((values[target_idx] - values[origin_idx]) / values[origin_idx])

        X = pd.DataFrame(rows, columns=FEATURE_COLUMNS)
        y = np.array(targets)
        self._models = {}
        for alpha in QUANTILE_ALPHAS:
            train_set = lgb.Dataset(X, label=y, free_raw_data=False)
            params = {
                "objective": "quantile",
                "alpha": alpha,
                "deterministic": True,
                "num_threads": 1,
                "seed": LGBM_SEED,
                "force_row_wise": True,
                # Weekly commodity price moves are ~1% noise around lag_1;
                # small/deep trees over a ~100-150 row direct-forecast set
                # nearly interpolate the training returns and collapse the
                # quantile spread to a sliver (measured live-DB coverage
                # ~0.3-0.5 with min_child_samples=5, num_leaves=31 default).
                # Heavy regularization forces the trees to fall back toward
                # the series' genuine conditional quantiles instead of
                # memorizing individual training points — tuned against the
                # FIX-2 seeded grade families (see T16 report): both land
                # every horizon's coverage_8090 inside PRD F4-AC1's [0.70, 0.90].
                "min_child_samples": 40,
                "num_leaves": 3,
                "verbosity": -1,
            }
            self._models[alpha] = lgb.train(params, train_set, num_boost_round=15)
        return self

    def predict(self) -> tuple[float, float, float]:
        """Band `horizon_weeks` past the last known price in the training data."""
        if self._models is None:
            return (self._fallback_price, self._fallback_price, self._fallback_price)

        values = self._last_values
        weeks = self._last_weeks
        origin_idx = len(values) - 1
        last_price = float(values[origin_idx])
        target_week = weeks[-1] + timedelta(weeks=self.horizon_weeks)
        row = build_price_feature_row(values, target_week, origin_idx)
        X = pd.DataFrame([row], columns=FEATURE_COLUMNS)
        p10, p50, p90 = (
            last_price * (1 + float(self._models[a].predict(X)[0])) for a in QUANTILE_ALPHAS
        )
        return (p10, p50, p90)


class RandomWalkBandModel:
    """Baseline band: historical weekly-return quantiles applied to the last
    observed price, spread scaled by sqrt(horizon) (a random walk's variance
    grows linearly with steps, so its spread grows with the square root).
    """

    def __init__(self, horizon_weeks: int) -> None:
        self.horizon_weeks = horizon_weeks

    def fit(self, train_df: pd.DataFrame) -> "RandomWalkBandModel":
        train_df = train_df.sort_values("week").reset_index(drop=True)
        prices = train_df["price_inr_mt"].to_numpy(dtype=float)
        self._last_price = float(prices[-1]) if len(prices) else 0.0
        self._returns = (
            np.diff(prices) / prices[:-1] if len(prices) >= 2 else np.zeros(1)
        )
        return self

    def predict(self) -> tuple[float, float, float]:
        scale = math.sqrt(self.horizon_weeks)
        q10, q50, q90 = np.quantile(self._returns, [0.1, 0.5, 0.9])
        last = self._last_price
        return (last * (1 + q10 * scale), last * (1 + q50 * scale), last * (1 + q90 * scale))


def repair_quantiles(p10: float, p50: float, p90: float) -> tuple[tuple[float, float, float], bool]:
    """Monotonic sort repair (PRD F4-ERR2): if raw quantiles cross, sorting
    them ascending is the documented fix. Returns (repaired triple, was_repaired).
    """
    sorted_triple = tuple(sorted((p10, p50, p90)))
    return sorted_triple, sorted_triple != (p10, p50, p90)
