"""Per-grade_family band construction at 1w/4w/12w horizons (F4-AC1/AC3,
F4-ERR1/ERR2)."""
from __future__ import annotations

import pandas as pd

from .backtest import rolling_origin_price_backtest
from .models import QuantilePriceModel, RandomWalkBandModel, repair_quantiles

HORIZONS_WEEKS = (1, 4, 12)
MIN_WEEKLY_POINTS = 52  # F4-ERR1: below this, fall back to the baseline model
BASELINE_FALLBACK = "BASELINE_FALLBACK"
QUANTILE_REPAIRED = "QUANTILE_REPAIRED"


def run_grade_family(weekly_df: pd.DataFrame, horizons: tuple[int, ...] = HORIZONS_WEEKS) -> dict:
    """Backtest + fit bands for one grade_family series across all horizons.

    weekly_df: DataFrame(grade_family, week, price_inr_mt) for a single grade
    family, as produced by `pdi_engine.data.weekly.weekly_prices`.

    Returns:
        {
          "baseline_fallback": bool,
          "quantile_repaired_count": int,
          "bands": [
            {"horizon_weeks", "p10_inr_mt", "p50_inr_mt", "p90_inr_mt",
             "coverage_8090", "pinball"},
            ...
          ],
        }
    """
    weekly_df = weekly_df.sort_values("week").reset_index(drop=True)
    n = len(weekly_df)
    use_baseline = n < MIN_WEEKLY_POINTS

    bands = []
    quantile_repaired_count = 0
    for horizon in horizons:
        model_factory = (
            (lambda h=horizon: RandomWalkBandModel(h))
            if use_baseline
            else (lambda h=horizon: QuantilePriceModel(h))
        )

        coverage, pinball = rolling_origin_price_backtest(model_factory, weekly_df, horizon)

        model = model_factory().fit(weekly_df)
        p10, p50, p90 = model.predict()
        (p10, p50, p90), repaired = repair_quantiles(p10, p50, p90)
        if repaired:
            quantile_repaired_count += 1

        bands.append(
            {
                "horizon_weeks": horizon,
                "p10_inr_mt": round(p10),
                "p50_inr_mt": round(p50),
                "p90_inr_mt": round(p90),
                "coverage_8090": coverage,
                "pinball": pinball,
            }
        )

    return {
        "baseline_fallback": use_baseline,
        "quantile_repaired_count": quantile_repaired_count,
        "bands": bands,
    }
