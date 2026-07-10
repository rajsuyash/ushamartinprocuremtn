"""M1 stubs for the three sequential run stages (T11, EXECUTION_PLAN D3).

The web-side orchestrator (apps/web/src/lib/run-orchestrator.ts) calls these in order:
demand forecast -> price forecast -> recommend. Each stub is stateless (writes nothing,
per PRD F2-ERR4 retry-safety) and returns zero-work counts so the orchestrator's
request/response contract is exercised end to end before the real analytics land.
"""
from fastapi import APIRouter
from pydantic import BaseModel

router = APIRouter(prefix="/v1", tags=["run-stages"])


class StageRequest(BaseModel):
    """Shared request body for every stage endpoint."""

    run_id: str


@router.post("/forecast/demand")
async def forecast_demand(body: StageRequest) -> dict[str, int]:
    # ponytail: M1 stub, zero-work counts — T14 replaces this with the real per-series
    # demand forecast (persists E10 rows, backtest WAPE, run warnings).
    return {"series": 0, "forecasts": 0}


@router.post("/forecast/price")
async def forecast_price(body: StageRequest) -> dict[str, int]:
    # ponytail: M1 stub, zero-work counts — T17 replaces this with the real price-band
    # forecast (persists E11 rows, p10<=p50<=p90 invariant).
    return {"series": 0, "bands": 0}


@router.post("/recommend")
async def recommend(body: StageRequest) -> dict[str, int]:
    # ponytail: M1 stub, zero-work counts — T22 replaces this with the real
    # recommendation generation (persists E13 rows, expires stale PENDING recs).
    return {"recommendations": 0}
