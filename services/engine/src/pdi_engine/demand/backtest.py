"""Rolling-origin backtest: re-fit per fold, leakage-guarded, WAPE-scored.

PRD F3 pitfall: a single fit scored across the whole holdout is
leakage-adjacent and inflates confidence — every fold gets a fresh model
fit strictly on data before its target week.
"""
from __future__ import annotations

from datetime import date
from typing import Callable, Protocol

import numpy as np
import pandas as pd

HOLDOUT_WEEKS = 26


class LeakageGuardError(Exception):
    """F3-ERR2: a fold's training window reached into or past its target week."""

    def __init__(self) -> None:
        super().__init__("LEAKAGE_GUARD")


class _Forecaster(Protocol):
    def fit(self, train_df: pd.DataFrame) -> "_Forecaster": ...
    def predict(self, horizon_weeks: int) -> np.ndarray: ...


def assert_no_leakage(train_df: pd.DataFrame, target_week: date) -> None:
    """Raise LeakageGuardError unless every training row is strictly before
    the target week."""
    if train_df.empty:
        return
    if train_df["week"].max() >= target_week:
        raise LeakageGuardError()


def rolling_origin_wape(
    model_factory: Callable[[], _Forecaster],
    weekly_df: pd.DataFrame,
    holdout_weeks: int = HOLDOUT_WEEKS,
) -> float:
    """Score `model_factory` over the last `holdout_weeks` weeks via 1-step-
    ahead rolling-origin folds: re-fit on data strictly before the fold's
    target week, predict one step, accumulate for WAPE.

    `model_factory` is called fresh per fold so no state (or accidental
    lookahead) carries across folds.
    """
    weekly_df = weekly_df.sort_values("week").reset_index(drop=True)
    n = len(weekly_df)
    first_target_idx = n - holdout_weeks

    abs_errors = []
    actuals = []
    for target_idx in range(first_target_idx, n):
        train = weekly_df.iloc[:target_idx]
        target_week = weekly_df["week"].iloc[target_idx]
        assert_no_leakage(train, target_week)

        model = model_factory().fit(train)
        forecast = float(model.predict(1)[0])
        actual = float(weekly_df["qty_mt"].iloc[target_idx])

        abs_errors.append(abs(actual - forecast))
        actuals.append(actual)

    denom = sum(actuals)
    if denom == 0:
        return 0.0 if sum(abs_errors) == 0 else float("inf")
    return float(sum(abs_errors) / denom)
