"""Rolling-origin price-band backtest: re-fit per fold, leakage-guarded,
scored by empirical coverage (share of actuals inside P10-P90) and pinball
loss — the honesty metrics PRD F4 requires reporting even when unflattering.

Reuses `pdi_engine.demand.backtest`'s leakage guard rather than duplicating
it: "every training row strictly before the target week" is the same
invariant for price series as it is for demand series.
"""
from __future__ import annotations

from typing import Callable, Protocol

import numpy as np
import pandas as pd

from ..demand.backtest import HOLDOUT_WEEKS, assert_no_leakage

__all__ = ["HOLDOUT_WEEKS", "pinball_loss", "rolling_origin_price_backtest"]


class _BandForecaster(Protocol):
    def fit(self, train_df: pd.DataFrame) -> "_BandForecaster": ...
    def predict(self) -> tuple[float, float, float]: ...


def pinball_loss(actual: float, predicted: float, alpha: float) -> float:
    diff = actual - predicted
    return max(alpha * diff, (alpha - 1) * diff)


def rolling_origin_price_backtest(
    model_factory: Callable[[], _BandForecaster],
    weekly_df: pd.DataFrame,
    horizon_weeks: int,
    holdout_weeks: int = HOLDOUT_WEEKS,
) -> tuple[float, float]:
    """Score `model_factory` over the last `holdout_weeks` weeks via
    direct-`horizon_weeks`-ahead rolling-origin folds: re-fit on data strictly
    before the fold's forecast origin, predict the band, accumulate coverage
    (P10<=actual<=P90) and mean pinball loss across the three quantiles.

    `model_factory` is called fresh per fold — no state carries across folds.
    Returns (coverage_8090, pinball).
    """
    weekly_df = weekly_df.sort_values("week").reset_index(drop=True)
    n = len(weekly_df)
    first_target_idx = max(n - holdout_weeks, horizon_weeks)

    hits: list[bool] = []
    losses: list[float] = []
    for target_idx in range(first_target_idx, n):
        origin_idx = target_idx - horizon_weeks
        train = weekly_df.iloc[: origin_idx + 1]
        target_week = weekly_df["week"].iloc[target_idx]
        assert_no_leakage(train, target_week)

        model = model_factory().fit(train)
        p10, p50, p90 = model.predict()
        actual = float(weekly_df["price_inr_mt"].iloc[target_idx])

        hits.append(p10 <= actual <= p90)
        losses.append(
            (
                pinball_loss(actual, p10, 0.1)
                + pinball_loss(actual, p50, 0.5)
                + pinball_loss(actual, p90, 0.9)
            )
            / 3.0
        )

    if not hits:
        return 0.0, 0.0
    return float(np.mean(hits)), float(np.mean(losses))
