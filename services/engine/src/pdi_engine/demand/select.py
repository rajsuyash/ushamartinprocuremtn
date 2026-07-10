"""Per-series winner selection: backtest all three models, forecast with the
lowest-WAPE one (F3-AC1/AC3, F3-ERR1)."""
from __future__ import annotations

from datetime import timedelta

import pandas as pd

from .backtest import HOLDOUT_WEEKS, rolling_origin_wape
from .models import ETSModel, LightGBMPointModel, SeasonalNaiveModel

FORECAST_HORIZON_WEEKS = 12
INSUFFICIENT_HISTORY = "INSUFFICIENT_HISTORY"

# Order matters for deterministic tie-breaking (min() keeps the first-seen
# key on an exact WAPE tie).
MODEL_FACTORIES = {
    "seasonal_naive": SeasonalNaiveModel,
    "ets": ETSModel,
    "lightgbm": LightGBMPointModel,
}


class InsufficientHistoryError(Exception):
    """F3-ERR1: series has too little history to run even one backtest fold."""

    def __init__(self, weeks: int) -> None:
        super().__init__(INSUFFICIENT_HISTORY)
        self.weeks = weeks


def run_series(weekly_df: pd.DataFrame, horizon: int = FORECAST_HORIZON_WEEKS) -> dict:
    """Backtest all three models on one material x plant series; forecast
    `horizon` weeks with the lowest-WAPE winner.

    weekly_df: DataFrame(week, qty_mt) for a single series, as produced by
    `pdi_engine.data.weekly.to_iso_weekly` filtered to one material x plant.

    Raises InsufficientHistoryError when the series has <= HOLDOUT_WEEKS
    weeks of history — PRD F3-ERR1 requires marking these INSUFFICIENT_HISTORY
    rather than backtesting; the boundary is set at HOLDOUT_WEEKS (not
    HOLDOUT_WEEKS - 1) because a series of exactly HOLDOUT_WEEKS weeks would
    leave zero training rows for even the first fold.
    """
    weekly_df = weekly_df.sort_values("week").reset_index(drop=True)
    n = len(weekly_df)
    if n <= HOLDOUT_WEEKS:
        raise InsufficientHistoryError(n)

    scores = {
        name: rolling_origin_wape(factory, weekly_df)
        for name, factory in MODEL_FACTORIES.items()
    }
    winner_name = min(scores, key=lambda name: scores[name])
    winner_model = MODEL_FACTORIES[winner_name]().fit(weekly_df)
    p50 = winner_model.predict(horizon)

    last_week = weekly_df["week"].iloc[-1]
    forecast = [
        {"week": last_week + timedelta(weeks=i + 1), "p50_qty_mt": float(p50[i])}
        for i in range(horizon)
    ]

    return {
        "model": winner_name,
        "backtest_wape": scores[winner_name],
        "forecast": forecast,
    }
