"""Shared synthetic-series helper for demand model/backtest/select tests."""
import math
from datetime import date, timedelta

import pandas as pd


def make_seasonal_weekly_df(
    n_weeks: int,
    amplitude: float = 20.0,
    base: float = 100.0,
    period: int = 52,
    start: date = date(2023, 1, 2),
) -> pd.DataFrame:
    """Deterministic weekly series with a pure `period`-week seasonal pattern,
    no noise — so seasonal_naive can reproduce it near-exactly."""
    weeks = [start + timedelta(weeks=i) for i in range(n_weeks)]
    qty = [
        base + amplitude * math.sin(2 * math.pi * (i % period) / period)
        for i in range(n_weeks)
    ]
    return pd.DataFrame({"week": weeks, "qty_mt": qty})
