"""T21 — Monte Carlo expected-impact (spike §2.3).

500 seeded price paths (`Generator(PCG64(42))`, one standard-normal draw per
path so weeks are rank-correlated — a persistent commodity trend, no implausible
weekly whipsaw). Each week's marginal reproduces the E11 band quantiles via a
piecewise-linear inverse-CDF through (0.10->P10, 0.50->P50, 0.90->P90).

Impact is measured on the **week-1 action** (the order lines the buyer acts on
this cycle) against a just-in-time counterfactual that buys the same volume as
late as consumption allows. `wcDeltaInr = qty x estPrice` matches the PRD F5
example (850 MT x 54200 = 46,070,000). Negative `costDeltaInr` = savings.

ponytail: one z per path, no per-week idiosyncratic shock or mean-reversion —
the band already carries horizon-scaled uncertainty. Baseline pricing is
volume-weighted-aggregate (supplier offer_base cancels in the delta, which is
market-timing-driven); upgrade to per-supplier JIT scheduling only if the impact
band reads implausibly tight.
"""
from __future__ import annotations

from math import erf, sqrt

import numpy as np

from .inputs import HORIZON_WEEKS, SeriesInputs
from .solver import SolveArtifacts

MC_SEED = 42
MC_PATHS = 500


def _phi(z: np.ndarray) -> np.ndarray:
    """Standard-normal CDF (no scipy dependency)."""
    return np.array([0.5 * (1.0 + erf(zi / sqrt(2.0))) for zi in z])


def _market_paths(inputs: SeriesInputs) -> np.ndarray:
    """(MC_PATHS x 12) market price per path per week from the band quantiles."""
    rng = np.random.Generator(np.random.PCG64(MC_SEED))
    u = _phi(rng.standard_normal(MC_PATHS))  # one draw per path
    p10, p50, p90 = inputs.price_paths.p10, inputs.price_paths.p50, inputs.price_paths.p90
    xp = [0.1, 0.5, 0.9]
    # np.interp flat-extrapolates outside [0.1, 0.9] -> P10 / P90 exactly.
    return np.column_stack(
        [np.interp(u, xp, [p10[t], p50[t], p90[t]]) for t in range(HORIZON_WEEKS)]
    )


def compute_impact(
    inputs: SeriesInputs,
    art: SolveArtifacts,
    action_orders: list[tuple[str, int, float]],
) -> dict:
    """expectedImpact for the surfaced action (list of (supplier, week, qty_mt)).

    Empty action (WAIT / HEDGE_LOCK) -> zero cost/WC impact, current cover.
    """
    spot = inputs.spot_inr_mt
    if not action_orders:
        return {
            "costDeltaInr": 0,
            "costDeltaP10Inr": 0,
            "costDeltaP90Inr": 0,
            "wcDeltaInr": 0,
            "coverAfterDays": round(inputs.cover_days, 1),
        }

    v1 = sum(qty for _, _, qty in action_orders)
    order_week = min(week for _, week, _ in action_orders)
    avg_offer = sum(qty * art.offer_base[s] for s, _, qty in action_orders) / v1
    avg_lead = round(sum(qty * art.lead_wk[s] for s, _, qty in action_orders) / v1)
    arrival_week = min(week + art.lead_wk[s] for s, week, _ in action_orders)

    mkt = _market_paths(inputs)  # (paths x 12)

    def mkt_at(week: int) -> np.ndarray:
        return mkt[:, min(max(week, 1), HORIZON_WEEKS) - 1]

    # Plan: whole action volume ordered now (week `order_week`).
    plan_cost = v1 * avg_offer * (mkt_at(order_week) / spot)

    # Baseline: same volume, JIT — spread over the weeks it is consumed, each
    # slice ordered `avg_lead` weeks before its consumption week.
    baseline_cost = np.zeros(MC_PATHS)
    remaining = v1
    week = arrival_week
    while remaining > 1e-9 and week <= HORIZON_WEEKS:
        take = min(remaining, inputs.demand_p50_mt[week - 1])
        baseline_cost += take * avg_offer * (mkt_at(week - avg_lead) / spot)
        remaining -= take
        week += 1
    if remaining > 1e-9:  # leftover beyond horizon -> priced at the last week
        baseline_cost += remaining * avg_offer * (mkt_at(HORIZON_WEEKS - avg_lead) / spot)

    # v1 is MT and avg_offer is INR/MT -> the products are already INR (the
    # solver's kg scaling never enters here; these are plain MT quantities).
    cost_delta = plan_cost - baseline_cost  # INR

    wc_delta = round(
        sum(qty * art.price_st[(s, week)] for s, week, qty in action_orders)
    )
    cover_after = art.inv_mt[arrival_week - 1] / art.add_daily_mt[arrival_week - 1]

    return {
        "costDeltaInr": int(round(np.median(cost_delta))),
        "costDeltaP10Inr": int(round(np.quantile(cost_delta, 0.10))),
        "costDeltaP90Inr": int(round(np.quantile(cost_delta, 0.90))),
        "wcDeltaInr": int(wc_delta),
        "coverAfterDays": round(float(cover_after), 1),
    }
