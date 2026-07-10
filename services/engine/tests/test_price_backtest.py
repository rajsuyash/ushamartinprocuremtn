"""Rolling-origin price backtest tests: coverage/pinball scoring + re-fit-per-
fold guarantee (T16, F4)."""
import numpy as np

from pdi_engine.price.backtest import (
    HOLDOUT_WEEKS,
    pinball_loss,
    rolling_origin_price_backtest,
)
from pdi_engine.price.models import RandomWalkBandModel

from .price_fixtures import make_price_weekly_df


def test_pinball_loss_is_zero_when_prediction_equals_actual():
    assert pinball_loss(actual=100.0, predicted=100.0, alpha=0.1) == 0.0
    assert pinball_loss(actual=100.0, predicted=100.0, alpha=0.9) == 0.0


def test_pinball_loss_penalizes_underprediction_more_at_high_alpha():
    under = pinball_loss(actual=110.0, predicted=100.0, alpha=0.9)
    over = pinball_loss(actual=90.0, predicted=100.0, alpha=0.9)
    assert under > over


def test_rolling_origin_price_backtest_returns_finite_coverage_and_pinball():
    df = make_price_weekly_df(n_weeks=104)

    coverage, pinball = rolling_origin_price_backtest(
        lambda: RandomWalkBandModel(4), df, horizon_weeks=4
    )

    assert 0.0 <= coverage <= 1.0
    assert np.isfinite(pinball)
    assert pinball >= 0.0


def test_rolling_origin_price_backtest_refits_per_fold_not_once():
    class CountingRandomWalk(RandomWalkBandModel):
        fit_calls = 0

        def fit(self, train_df):
            type(self).fit_calls += 1
            return super().fit(train_df)

    df = make_price_weekly_df(n_weeks=60)
    CountingRandomWalk.fit_calls = 0

    rolling_origin_price_backtest(lambda: CountingRandomWalk(4), df, horizon_weeks=4)

    assert CountingRandomWalk.fit_calls == HOLDOUT_WEEKS
