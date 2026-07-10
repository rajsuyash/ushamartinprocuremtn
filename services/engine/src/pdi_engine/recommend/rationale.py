"""T21 — rationale JSON builder (spike §2.4, PRD F5 example shape).

Emits the exact camelCase structure the cockpit renders from the STORED JSON
(pitfall: never recomputed client-side). All values come straight from solve
artifacts + the classification flags.
"""
from __future__ import annotations

from .classifier import Classification
from .inputs import SeriesInputs
from .solver import SolveArtifacts


def _drivers(inputs: SeriesInputs, cls: Classification, wc_relaxed: bool) -> list[dict]:
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
        "drivers": _drivers(inputs, cls, art.wc_relaxed),
        "constraintsRespected": constraints,
    }
