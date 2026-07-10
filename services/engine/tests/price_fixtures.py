"""Shared synthetic-series helper for price model/backtest/select tests."""
from datetime import date, timedelta

import numpy as np
import pandas as pd

SEED = 42  # project-wide deterministic RNG seed (PRD §10)


def make_price_weekly_df(
    n_weeks: int,
    base: float = 54_000.0,
    daily_vol: float = 0.01,
    seed: int = SEED,
    start: date = date(2023, 1, 2),
) -> pd.DataFrame:
    """Deterministic synthetic weekly price random walk: log-returns drawn
    from a fixed-seed normal distribution so the series is reproducible
    across test runs without depending on the live DB."""
    rng = np.random.default_rng(seed)
    weeks = [start + timedelta(weeks=i) for i in range(n_weeks)]
    log_returns = rng.normal(loc=0.0, scale=daily_vol, size=n_weeks - 1)
    prices = [base]
    for r in log_returns:
        prices.append(prices[-1] * (1 + r))
    return pd.DataFrame({"grade_family": "TEST-GRADE", "week": weeks, "price_inr_mt": prices})
