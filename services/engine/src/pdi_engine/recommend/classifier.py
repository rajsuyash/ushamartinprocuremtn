"""T21 — deterministic play classifier (spike §2.2).

First-match-wins decision tree over quantities derived from the solved plan.
Exactly one of the five plays. HEDGE_LOCK and WAIT carry no order lines; the
orchestrator enforces the HEDGE_LOCK empty-lines invariant (pitfall).
"""
from __future__ import annotations

from dataclasses import dataclass

from .inputs import SeriesInputs
from .solver import SolveArtifacts

SPLIT_MIN_SHARE = 0.20  # week-1 supplier counts toward a split at >=20% of w1 qty
RESTORE_FRAC = 0.90  # < 0.90 x restore -> PARTIAL_BUY
RISE_EPS = 0.01  # band "rising" threshold vs spot
HEDGE_SPREAD = 0.08  # 4w band width / P50 above which HEDGE_LOCK is eligible


@dataclass
class Classification:
    play: str
    w1_qty_mt: float
    w1_suppliers: list[str]
    restore_qty_mt: float
    spread4: float
    rising: bool
    comfortable: bool
    cover_below_floor: bool
    action_week: int  # week whose orders are surfaced as order lines


def _first_order_week(art: SolveArtifacts) -> int:
    weeks = sorted({t for (_, t) in art.q_mt})
    return weeks[0] if weeks else 1


def classify(inputs: SeriesInputs, art: SolveArtifacts) -> Classification:
    policy = inputs.policy
    w1_by_supplier = {s: qty for (s, t), qty in art.q_mt.items() if t == 1}
    w1_qty = sum(w1_by_supplier.values())
    w1_suppliers = [
        s for s, qty in w1_by_supplier.items() if qty >= SPLIT_MIN_SHARE * w1_qty
    ] if w1_qty > 0 else []

    restore_qty = max(
        0.0, policy.target_cover_days * inputs.avg_daily_demand_mt - inputs.on_hand_mt
    )
    b4 = inputs.band_4w
    spread4 = (b4.p90_inr_mt - b4.p10_inr_mt) / b4.p50_inr_mt
    rising = inputs.price_paths.p50[3] > inputs.spot_inr_mt * (1 + RISE_EPS)  # week-4
    cover_below_floor = inputs.cover_days < policy.min_cover_days

    # comfortable: no week-1 order needed AND cover healthy AND every enforced
    # week holds the floor in the solved plan.
    floor_ok = all(
        art.inv_mt[t - 1] + 1e-6 >= art.floor_mt[t - 1]
        for t in range(art.earliest_arrival, len(art.inv_mt) + 1)
    )
    comfortable = (
        w1_qty == 0 and inputs.cover_days >= policy.min_cover_days and floor_ok
    )

    # A WC-relaxed solve is best-effort by definition (spike §2.1 step 2): the
    # plan could not honor the working-capital cap, so it is a PARTIAL_BUY
    # regardless of what the normal tree would say.
    if art.wc_relaxed:
        play = "PARTIAL_BUY"
        action_week = 1 if w1_qty > 0 else _first_order_week(art)
    # First-match-wins (spike §2.2).
    elif w1_qty > 0 and len(w1_suppliers) >= 2:
        play, action_week = "SPLIT_SUPPLIERS", 1
    elif w1_qty > 0 and w1_qty < RESTORE_FRAC * restore_qty:
        play, action_week = "PARTIAL_BUY", 1
    elif w1_qty > 0:
        play, action_week = "BUY_NOW", 1
    elif not comfortable:
        play, action_week = "BUY_NOW", _first_order_week(art)  # defensive
    elif spread4 > HEDGE_SPREAD:
        play, action_week = "HEDGE_LOCK", 1  # memo-only, lines forced empty
    else:
        play, action_week = "WAIT", 1

    return Classification(
        play=play,
        w1_qty_mt=w1_qty,
        w1_suppliers=sorted(w1_suppliers),
        restore_qty_mt=restore_qty,
        spread4=spread4,
        rising=rising,
        comfortable=comfortable,
        cover_below_floor=cover_below_floor,
        action_week=action_week,
    )
