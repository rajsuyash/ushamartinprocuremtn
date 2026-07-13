"""F10 — scenario simulation (what-if sandbox).

POST /v1/simulate re-runs the F5 pipeline for one series with in-memory
parameter overrides (policy knobs, lead-time buffer, price-band shift, forced
purchase qty) and returns baseline vs simulated results plus deltas.

Read-only by contract: reuses `assemble_series_inputs` (reads this run's
E10/E11 + committed data) and the pure solve/classify/impact/rationale chain.
It never writes E10/E11/E13/E15 rows — nothing analytical is persisted.
"""
from __future__ import annotations

import asyncio
from datetime import timedelta
from math import ceil
from uuid import UUID

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field, field_validator

from ..data.readers import load_materials
from ..recommend.checker import check_solution
from ..recommend.inputs import (
    DAYS_PER_WEEK,
    HORIZON_WEEKS,
    MissingDemandError,
    MissingPriceBandError,
    SeriesInputs,
    _iso_monday,
    assemble_series_inputs,
    forward_avg_daily_demand,
)
from ..recommend.montecarlo import compute_impact
from ..recommend.recommend import recommend_series
from ..recommend.solver import SolveArtifacts, _price

router = APIRouter(prefix="/v1", tags=["simulate"])

SIM_TIME_BUDGET_S = 10.0  # tighter than the run pipeline's 30s — interactive


class SimulateOverrides(BaseModel):
    """All optional; bounds mirror the shared zod schema (packages/shared)."""

    forced_qty_mt: float | None = Field(default=None, gt=0, le=100_000)
    lead_time_buffer_days: int | None = Field(default=None, ge=-14, le=30)
    price_shift_pct: float | None = Field(default=None, ge=-20, le=20)
    min_cover_days: int | None = Field(default=None, ge=1, le=120)
    max_supplier_share_pct: float | None = Field(default=None, ge=1, le=100)
    wc_cap_inr: int | None = Field(default=None, ge=0)


class SimulateRequest(BaseModel):
    run_id: str
    material_code: str
    plant_code: str
    overrides: SimulateOverrides = SimulateOverrides()

    @field_validator("run_id")
    @classmethod
    def _run_id_must_be_uuid(cls, value: str) -> str:
        try:
            UUID(value)
        except ValueError as exc:
            raise ValueError("run_id must be a valid UUID") from exc
        return value


def apply_overrides(inputs: SeriesInputs, ov: SimulateOverrides) -> SeriesInputs:
    """Pure: return a tweaked copy of `inputs`. The original is never mutated."""
    policy_updates = {
        k: v
        for k, v in {
            "min_cover_days": ov.min_cover_days,
            "max_supplier_share_pct": ov.max_supplier_share_pct,
            "wc_cap_inr": ov.wc_cap_inr,
        }.items()
        if v is not None
    }
    updates: dict = {}
    if policy_updates:
        updates["policy"] = inputs.policy.model_copy(update=policy_updates)

    if ov.lead_time_buffer_days is not None:
        updates["offers"] = [
            o.model_copy(
                update={
                    "lead_time_days": max(0, o.lead_time_days + ov.lead_time_buffer_days),
                    "lead_weeks": ceil(
                        max(0, o.lead_time_days + ov.lead_time_buffer_days) / DAYS_PER_WEEK
                    ),
                }
            )
            for o in inputs.offers
        ]

    if ov.price_shift_pct is not None:
        # Shift the FORWARD outlook only — spot is known today and stays fixed.
        f = 1 + ov.price_shift_pct / 100
        pp = inputs.price_paths
        updates["price_paths"] = pp.model_copy(
            update={
                "p10": [int(round(v * f)) for v in pp.p10],
                "p50": [int(round(v * f)) for v in pp.p50],
                "p90": [int(round(v * f)) for v in pp.p90],
            }
        )
        b4 = inputs.band_4w
        updates["band_4w"] = b4.model_copy(
            update={
                "p10_inr_mt": int(round(b4.p10_inr_mt * f)),
                "p50_inr_mt": int(round(b4.p50_inr_mt * f)),
                "p90_inr_mt": int(round(b4.p90_inr_mt * f)),
            }
        )

    return inputs.model_copy(update=updates) if updates else inputs


def forced_plan(inputs: SeriesInputs, qty_mt: float) -> dict:
    """Impact of force-buying `qty_mt` at week 1 from the cheapest in-horizon
    supplier — no optimization; the independent checker re-simulates inventory
    and reports any cover/share violations honestly instead of blocking."""
    deliverable = [o for o in inputs.offers if 1 + o.lead_weeks <= HORIZON_WEEKS]
    if not deliverable:
        return {
            "materialCode": inputs.material_code,
            "plantCode": inputs.plant_code,
            "play": None,
            "orderLines": [],
            "expectedImpact": None,
            "rationale": {"error": {"code": "NO_IN_HORIZON_SUPPLIER"}},
            "status": "ERROR",
            "error": {"code": "NO_IN_HORIZON_SUPPLIER"},
        }
    cheapest = min(deliverable, key=lambda o: o.offer_base_inr)
    s = cheapest.supplier_code

    suppliers = [o.supplier_code for o in inputs.offers]
    lead_wk = {o.supplier_code: o.lead_weeks for o in inputs.offers}
    offer_base = {o.supplier_code: o.offer_base_inr for o in inputs.offers}
    price_st = {
        (sc, t): _price(offer_base[sc], inputs.price_paths.p50[t - 1], inputs.spot_inr_mt)
        for sc in suppliers
        for t in range(1, HORIZON_WEEKS + 1)
    }
    art = SolveArtifacts(
        status="FEASIBLE",
        suppliers=suppliers,
        lead_wk=lead_wk,
        offer_base=offer_base,
        price_st=price_st,
        q_mt={(s, 1): qty_mt},
        add_daily_mt=[
            forward_avg_daily_demand(inputs.demand_p50_mt, t)
            for t in range(1, HORIZON_WEEKS + 1)
        ],
        earliest_arrival=1 + min(o.lead_weeks for o in deliverable),
    )
    check = check_solution(inputs, art)
    art.inv_mt = check.inv_mt

    impact = compute_impact(inputs, art, [(s, 1, qty_mt)])
    # targetWeek label parity with recommend_series: week-1 ISO Monday.
    target_week = (_iso_monday(inputs.as_of) + timedelta(weeks=1)).isoformat()

    return {
        "materialCode": inputs.material_code,
        "plantCode": inputs.plant_code,
        "play": "BUY_NOW",
        "orderLines": [
            {
                "supplierCode": s,
                "qtyMt": round(qty_mt, 3),
                "targetWeek": target_week,
                "estPriceInrMt": price_st[(s, 1)],
            }
        ],
        "expectedImpact": impact,
        "rationale": {
            "inputs": {
                "coverDays": round(inputs.cover_days, 1),
                "minCoverDays": inputs.policy.min_cover_days,
                "spotInrMt": inputs.spot_inr_mt,
            },
            "drivers": [
                {
                    "factor": "FORCED_QTY",
                    "detail": f"user forced {qty_mt:g} MT at week 1 via {s}",
                }
            ],
            "constraintsRespected": [],
        },
        "status": "PENDING",
        "constraintCheck": {
            "ok": check.ok,
            "coverViolations": check.cover_violations,
            "shareViolations": check.share_violations,
        },
    }


def compute_deltas(baseline: dict, simulated: dict) -> dict | None:
    b, s = baseline.get("expectedImpact"), simulated.get("expectedImpact")
    if not b or not s:
        return None
    return {
        "costDeltaInr": s["costDeltaInr"] - b["costDeltaInr"],
        "wcDeltaInr": s["wcDeltaInr"] - b["wcDeltaInr"],
        "coverAfterDays": round(s["coverAfterDays"] - b["coverAfterDays"], 1),
        "playChanged": simulated.get("play") != baseline.get("play"),
    }


def _simulate_sync(req: SimulateRequest) -> dict:
    materials = load_materials()
    grade_by_code = dict(zip(materials["code"], materials["grade_family"], strict=True))
    grade_family = grade_by_code.get(req.material_code)
    if grade_family is None:
        raise HTTPException(status_code=422, detail={"code": "UNKNOWN_MATERIAL"})

    try:
        baseline_inputs = assemble_series_inputs(
            req.run_id, req.material_code, req.plant_code, grade_family
        )
    except MissingDemandError as exc:
        raise HTTPException(status_code=422, detail={"code": "MISSING_DEMAND"}) from exc
    except MissingPriceBandError as exc:
        raise HTTPException(status_code=422, detail={"code": "MISSING_PRICE_BAND"}) from exc

    baseline = recommend_series(baseline_inputs, time_budget_s=SIM_TIME_BUDGET_S)

    tweaked = apply_overrides(baseline_inputs, req.overrides)
    if req.overrides.forced_qty_mt is not None:
        simulated = forced_plan(tweaked, req.overrides.forced_qty_mt)
    else:
        simulated = recommend_series(tweaked, time_budget_s=SIM_TIME_BUDGET_S)

    return {
        "baseline": baseline,
        "simulated": simulated,
        "deltas": compute_deltas(baseline, simulated),
        "overridesApplied": req.overrides.model_dump(exclude_none=True),
        "policy": {
            "minCoverDays": tweaked.policy.min_cover_days,
            "targetCoverDays": tweaked.policy.target_cover_days,
            "maxSupplierSharePct": tweaked.policy.max_supplier_share_pct,
            "wcCapInr": tweaked.policy.wc_cap_inr,
        },
    }


@router.post("/simulate")
async def simulate(body: SimulateRequest) -> dict:
    return await asyncio.to_thread(_simulate_sync, body)
