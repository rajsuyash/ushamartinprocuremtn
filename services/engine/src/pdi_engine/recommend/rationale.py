"""T21 — rationale JSON builder (spike §2.4, PRD F5 example shape).

Emits the exact camelCase structure the cockpit renders from the STORED JSON
(pitfall: never recomputed client-side). All values come straight from solve
artifacts + the classification flags.
"""
from __future__ import annotations

from .classifier import Classification
from .inputs import HORIZON_WEEKS, SeriesInputs, forward_avg_daily_demand
from .solver import SolveArtifacts

_BUYING_PLAYS = {"BUY_NOW", "PARTIAL_BUY", "SPLIT_SUPPLIERS"}


def _first_projected_breach(inputs: SeriesInputs, start_week: int) -> int | None:
    """First horizon week (>= earliest achievable arrival) where cover dips below
    the floor under a no-buy simulation (on-hand + committed open POs only)."""
    on_hand = inputs.on_hand_mt
    for t in range(1, HORIZON_WEEKS + 1):
        on_hand += inputs.open_po_mt_by_week[t - 1] - inputs.demand_p50_mt[t - 1]
        if t < start_week:
            continue
        floor = inputs.policy.min_cover_days * forward_avg_daily_demand(inputs.demand_p50_mt, t)
        if on_hand < floor:
            return t
    return None


def _drivers(inputs: SeriesInputs, cls: Classification, art: SolveArtifacts) -> list[dict]:
    wc_relaxed = art.wc_relaxed
    drivers: list[dict] = []
    if cls.cover_below_floor:
        drivers.append(
            {
                "factor": "COVER_BELOW_FLOOR",
                "detail": f"{inputs.cover_days:.1f}d vs {inputs.policy.min_cover_days}d policy floor",
            }
        )
    if cls.rising:
        pct = (inputs.price_paths.p50[3] / inputs.spot_inr_mt - 1) * 100
        drivers.append({"factor": "BAND_RISING", "detail": f"P50 +{pct:.1f}% vs spot at 4w"})
    if cls.comfortable:
        drivers.append(
            {
                "factor": "COVER_COMFORTABLE",
                "detail": f"{inputs.cover_days:.1f}d cover, above {inputs.policy.min_cover_days}d floor",
            }
        )
    if cls.spread4 > 0.08:
        drivers.append(
            {"factor": "BAND_WIDE", "detail": f"4w band width {cls.spread4 * 100:.1f}% of P50"}
        )
    if wc_relaxed:
        drivers.append(
            {"factor": "WC_CAP_RELAXED", "detail": "working-capital cap relaxed to hold cover floor"}
        )

    # Invariant: a plan that orders always explains why. When cover is between
    # floor and target and the band is flat, none of the rules above fire — so
    # derive the real reason from the solve (a projected breach the buy prevents,
    # else a price opportunity from the band drift). No audit-trail hole.
    if not drivers and cls.play in _BUYING_PLAYS:
        breach_week = _first_projected_breach(inputs, art.earliest_arrival)
        if breach_week is not None:
            drivers.append(
                {
                    "factor": "PROJECTED_COVER_BREACH",
                    "detail": f"cover dips below {inputs.policy.min_cover_days}d floor at week {breach_week}",
                }
            )
        else:
            pct = (inputs.price_paths.p50[3] / inputs.spot_inr_mt - 1) * 100
            drivers.append(
                {"factor": "PRICE_OPPORTUNITY", "detail": f"P50 {pct:+.1f}% vs spot at 4w"}
            )
    return drivers


def build_rationale(inputs: SeriesInputs, art: SolveArtifacts, cls: Classification) -> dict:
    policy = inputs.policy
    b4 = inputs.band_4w
    constraints = [
        f"MIN_COVER_{policy.min_cover_days}D",
        f"MAX_SUPPLIER_SHARE_{int(policy.max_supplier_share_pct)}",
    ]
    if policy.wc_cap_inr is not None and not art.wc_relaxed:
        constraints.append("WC_CAP")

    return {
        "inputs": {
            "coverDays": round(inputs.cover_days, 1),
            "minCoverDays": policy.min_cover_days,
            "band4w": {
                "p10": b4.p10_inr_mt,
                "p50": b4.p50_inr_mt,
                "p90": b4.p90_inr_mt,
            },
            "spotInrMt": inputs.spot_inr_mt,
            "spread": {o.supplier_code: o.offer_base_inr for o in inputs.offers},
        },
        "drivers": _drivers(inputs, cls, art),
        "constraintsRespected": constraints,
    }
