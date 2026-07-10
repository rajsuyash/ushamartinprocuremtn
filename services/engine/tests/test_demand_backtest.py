"""Rolling-origin backtest tests: WAPE scoring + leakage guard (F3-ERR2)."""
import numpy as np
import pytest

from pdi_engine.demand.backtest import (
    HOLDOUT_WEEKS,
    LeakageGuardError,
    assert_no_leakage,
    rolling_origin_wape,
)
from pdi_engine.demand.models import SeasonalNaiveModel

from .demand_fixtures import make_seasonal_weekly_df


def test_rolling_origin_wape_is_finite_and_near_zero_for_pure_seasonal_naive_fit():
    df = make_seasonal_weekly_df(n_weeks=104)

    wape = rolling_origin_wape(SeasonalNaiveModel, df)

    assert np.isfinite(wape)
    assert wape < 0.01  # exact seasonal repeat -> near-perfect naive forecast


def test_rolling_origin_wape_refits_per_fold_not_once():
    """A stub model that records how many times fit() is called must be
    invoked once per holdout week, not once for the whole holdout — this is
    the re-fit-per-fold guarantee the PRD calls out as a leakage-adjacent
    pitfall if skipped."""

    class CountingNaive(SeasonalNaiveModel):
        fit_calls = 0

        def fit(self, train_df):
            type(self).fit_calls += 1
            return super().fit(train_df)

    df = make_seasonal_weekly_df(n_weeks=60)
    CountingNaive.fit_calls = 0

    rolling_origin_wape(CountingNaive, df)

    assert CountingNaive.fit_calls == HOLDOUT_WEEKS


def test_leakage_guard_raises_on_overlapping_training_window():
    df = make_seasonal_weekly_df(n_weeks=60)
    target_idx = 40
    target_week = df["week"].iloc[target_idx]
    # Deliberately overlapping: includes the target row itself, unlike the
    # correct `df.iloc[:target_idx]` slice rolling_origin_wape actually uses.
    overlapping_train = df.iloc[: target_idx + 1]

    with pytest.raises(LeakageGuardError, match="LEAKAGE_GUARD"):
        assert_no_leakage(overlapping_train, target_week)


def test_leakage_guard_passes_on_correct_non_overlapping_window():
    df = make_seasonal_weekly_df(n_weeks=60)
    target_idx = 40
    target_week = df["week"].iloc[target_idx]
    correct_train = df.iloc[:target_idx]

    assert_no_leakage(correct_train, target_week)  # must not raise
