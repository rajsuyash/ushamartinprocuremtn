"""T21 — series recommendation orchestrator.

`recommend_series(inputs)` runs the solve -> classify -> impact -> rationale
pipeline and returns a Recommendation-shaped dict (E13, camelCase). `id`/`runId`
are stamped by the persistence layer (T22), not here.

Degraded outcomes are returned as `status: "ERROR"` with an `error` code so the
run can record a recommendation-level error row and continue (F5-ERR1 /
F5-ERR3) — the pipeline never crashes for one series.
"""
from __future__ import annotations

from datetime import timedelta

from .classifier import Classification, classify
from .inputs import HORIZON_WEEKS, SeriesInputs, _iso_monday
from .montecarlo import compute_impact
from .rationale import build_rationale
from .solver import DEFAULT_TIME_BUDGET_S, solve_series

# Plays that never carry order lines (pitfall: HEDGE_LOCK is memo-only).
_NO_LINE_PLAYS = {"WAIT", "HEDGE_LOCK"}


def _restore_line(inputs: SeriesInputs, cls: Classification) -> tuple[str, float]:
    """Earliest-feasible restore order for a defensive BUY_NOW: the cheapest
    in-horizon supplier, sized to lift cover back to the floor now."""
    deliverable = [o for o in inputs.offers if 1 + o.lead_weeks <= HORIZON_WEEKS]
    cheapest = min(deliverable, key=lambda o: o.offer_base_inr)
    floor_deficit = inputs.policy.min_cover_days * inputs.avg_daily_demand_mt - inputs.on_hand_mt
    qty = max(cls.restore_qty_mt, floor_deficit)
    return cheapest.supplier_code, qty


def _error(material: str, plant: str, code: str, detail: dict | None = None) -> dict:
    err: dict = {"code": code}
    if detail:
        err.update(detail)
    return {
        "materialCode": material,
        "plantCode": plant,
        "play": None,
        "orderLines": [],
        "expectedImpact": None,
        "rationale": None,
        "status": "ERROR",
        "error": err,
    }


def recommend_series(
    inputs: SeriesInputs, time_budget_s: float = DEFAULT_TIME_BUDGET_S
) -> dict:
    art = solve_series(inputs, time_budget_s=time_budget_s)

    if art.status == "TIMEOUT":
        return _error(inputs.material_code, inputs.plant_code, "SOLVER_TIMEOUT")
    if art.status == "MODEL_INVALID":
        return _error(inputs.material_code, inputs.plant_code, "MODEL_INVALID")
    if art.status == "INFEASIBLE":
        return _error(
            inputs.material_code,
            inputs.plant_code,
            "NO_FEASIBLE_PLAN",
            {"bindingConstraints": art.binding_constraints},
        )

    cls = classify(inputs, art)

    order_lines: list[dict] = []
    action_orders: list[tuple[str, int, float]] = []
    if cls.play not in _NO_LINE_PLAYS:
        week0_monday = _iso_monday(inputs.as_of)
        target_week = (week0_monday + timedelta(weeks=cls.action_week)).isoformat()
        for (s, t), qty in sorted(art.q_mt.items()):
            if t == cls.action_week:
                order_lines.append(
                    {
                        "supplierCode": s,
                        "qtyMt": round(qty, 3),
                        "targetWeek": target_week,
                        "estPriceInrMt": art.price_st[(s, t)],
                    }
                )
                action_orders.append((s, t, qty))

        # Defensive BUY_NOW (classifier row 4): the plan bought nothing at the
        # action week — cover breaches now but recovers unaided later, so the
        # MILP had no forced order to surface. Synthesize the earliest-feasible
        # restore line so the buyer still has something to act on (spike §2.2).
        if cls.play == "BUY_NOW" and not order_lines:
            s, qty = _restore_line(inputs, cls)
            order_lines.append(
                {
                    "supplierCode": s,
                    "qtyMt": round(qty, 3),
                    "targetWeek": target_week,
                    "estPriceInrMt": art.price_st[(s, cls.action_week)],
                }
            )
            action_orders.append((s, cls.action_week, qty))

    impact = compute_impact(inputs, art, action_orders)
    rationale = build_rationale(inputs, art, cls)

    return {
        "materialCode": inputs.material_code,
        "plantCode": inputs.plant_code,
        "play": cls.play,
        "orderLines": order_lines,
        "expectedImpact": impact,
        "rationale": rationale,
        "status": "PENDING",
    }
