"""Run-stage endpoints (T11, EXECUTION_PLAN D3).

The web-side orchestrator (apps/web/src/lib/run-orchestrator.ts) calls these in order:
demand forecast -> price forecast -> recommend -> alerts. All four (T14, T17, T22, T28)
are real implementations persisting E10/E11/E13/E15 rows.
"""
from __future__ import annotations

import asyncio
from uuid import UUID

import psycopg
from fastapi import APIRouter
from psycopg.types.json import Jsonb
from pydantic import BaseModel, field_validator

from ..config import get_settings
from ..data.db import query_df
from ..data.readers import load_consumption, load_market_prices, load_materials
from ..data.weekly import to_iso_weekly, weekly_prices
from ..demand.select import InsufficientHistoryError, run_series
from ..price.select import BASELINE_FALLBACK, QUANTILE_REPAIRED, run_grade_family
from ..recommend.classifier import HEDGE_SPREAD
from ..recommend.inputs import (
    MissingDemandError,
    MissingPriceBandError,
    SeriesInputs,
    assemble_series_inputs,
    list_series,
)
from ..recommend.rationale import _first_projected_breach
from ..recommend.recommend import recommend_series

router = APIRouter(prefix="/v1", tags=["run-stages"])


class StageRequest(BaseModel):
    """Shared request body for every stage endpoint."""

    run_id: str

    @field_validator("run_id")
    @classmethod
    def _run_id_must_be_uuid(cls, value: str) -> str:
        try:
            UUID(value)
        except ValueError as exc:
            raise ValueError("run_id must be a valid UUID") from exc
        return value


def _persist_forecasts(run_id: str, rows: list[dict]) -> None:
    """Delete-and-rewrite this run_id's demand_forecasts rows (retry-safe within
    a run; analytical rows are never mutated across runs — PRD §7 invariant)."""
    with psycopg.connect(get_settings().database_url) as conn, conn.cursor() as cur:
        cur.execute("DELETE FROM demand_forecasts WHERE run_id = %s", (run_id,))
        if not rows:
            return

        cur.execute("SELECT code, id FROM materials")
        material_ids = dict(cur.fetchall())
        cur.execute("SELECT code, id FROM plants")
        plant_ids = dict(cur.fetchall())

        cur.executemany(
            """
            INSERT INTO demand_forecasts
                (run_id, material_id, plant_id, week, p50_qty_mt, model, backtest_wape)
            VALUES (%s, %s, %s, %s, %s, %s, %s)
            """,
            [
                (
                    run_id,
                    material_ids[row["material_code"]],
                    plant_ids[row["plant_code"]],
                    row["week"],
                    row["p50_qty_mt"],
                    row["model"],
                    row["backtest_wape"],
                )
                for row in rows
            ],
        )
    # psycopg3 connection context manager commits on clean exit, rolls back on
    # exception — no manual commit needed.


def _forecast_demand_sync(run_id: str) -> dict:
    """F3-AC1: forecast every active material x plant series and persist 12
    weekly rows each. Blocking (pandas/LightGBM + DB I/O) — called via
    asyncio.to_thread from the async handler so it never blocks the event
    loop (known pitfall: sync work in async handlers)."""
    consumption = load_consumption()
    weekly = to_iso_weekly(consumption)
    series_keys = weekly[["material_code", "plant_code"]].drop_duplicates()

    forecast_rows: list[dict] = []
    warnings: list[dict] = []
    n_succeeded = 0

    for _, key in series_keys.iterrows():
        material_code, plant_code = key["material_code"], key["plant_code"]
        series_df = weekly[
            (weekly["material_code"] == material_code)
            & (weekly["plant_code"] == plant_code)
        ][["week", "qty_mt"]].reset_index(drop=True)

        try:
            result = run_series(series_df)
        except InsufficientHistoryError:
            # F3-ERR1: too little history to backtest — skip, warn, keep going.
            warnings.append(
                {
                    "code": "INSUFFICIENT_HISTORY",
                    "material_code": material_code,
                    "plant_code": plant_code,
                }
            )
            continue
        except Exception as exc:  # noqa: BLE001 - one bad series must never crash the stage
            warnings.append(
                {
                    "code": "SERIES_FAILED",
                    "material_code": material_code,
                    "plant_code": plant_code,
                    "detail": str(exc),
                }
            )
            continue

        n_succeeded += 1
        forecast_rows.extend(
            {
                "material_code": material_code,
                "plant_code": plant_code,
                "week": point["week"],
                "p50_qty_mt": point["p50_qty_mt"],
                "model": result["model"],
                "backtest_wape": result["backtest_wape"],
            }
            for point in result["forecast"]
        )

    _persist_forecasts(run_id, forecast_rows)

    return {"series": n_succeeded, "forecasts": len(forecast_rows), "warnings": warnings}


@router.post("/forecast/demand")
async def forecast_demand(body: StageRequest) -> dict:
    return await asyncio.to_thread(_forecast_demand_sync, body.run_id)


def _persist_price_forecasts(run_id: str, rows: list[dict]) -> None:
    """Delete-and-rewrite this run_id's price_forecasts rows — same per-run
    idempotency pattern as demand_forecasts (PRD §7 invariant)."""
    with psycopg.connect(get_settings().database_url) as conn, conn.cursor() as cur:
        cur.execute("DELETE FROM price_forecasts WHERE run_id = %s", (run_id,))
        if not rows:
            return

        cur.executemany(
            """
            INSERT INTO price_forecasts
                (run_id, grade_family, horizon_weeks, p10_inr_mt, p50_inr_mt, p90_inr_mt,
                 coverage_8090, pinball)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
            """,
            [
                (
                    run_id,
                    row["grade_family"],
                    row["horizon_weeks"],
                    row["p10_inr_mt"],
                    row["p50_inr_mt"],
                    row["p90_inr_mt"],
                    row["coverage_8090"],
                    row["pinball"],
                )
                for row in rows
            ],
        )


def _forecast_price_sync(run_id: str) -> dict:
    """F4-AC1: band-forecast every grade_family at 1w/4w/12w horizons and
    persist rows. Blocking (pandas/LightGBM + DB I/O) — called via
    asyncio.to_thread from the async handler so it never blocks the event
    loop (known pitfall: sync work in async handlers)."""
    prices = load_market_prices()
    grade_families = sorted(prices["grade_family"].unique())

    band_rows: list[dict] = []
    warnings: list[dict] = []
    n_succeeded = 0

    for grade_family in grade_families:
        weekly = weekly_prices(prices, grade_family=grade_family)

        try:
            result = run_grade_family(weekly)
        except Exception as exc:  # noqa: BLE001 - one bad grade family must never crash the stage
            warnings.append(
                {"code": "SERIES_FAILED", "grade_family": grade_family, "detail": str(exc)}
            )
            continue

        n_succeeded += 1
        if result["baseline_fallback"]:
            # F4-ERR1: too little history for the quantile model — fell back
            # to the random-walk baseline band, flagged rather than hidden.
            warnings.append({"code": BASELINE_FALLBACK, "grade_family": grade_family})
        if result["quantile_repaired_count"]:
            # F4-ERR2: raw quantiles crossed and were monotonic-repaired.
            warnings.append(
                {
                    "code": QUANTILE_REPAIRED,
                    "grade_family": grade_family,
                    "count": result["quantile_repaired_count"],
                }
            )

        for band in result["bands"]:
            p10, p50, p90 = band["p10_inr_mt"], band["p50_inr_mt"], band["p90_inr_mt"]
            assert p10 <= p50 <= p90, (
                f"F4 band-order invariant violated for {grade_family} "
                f"h={band['horizon_weeks']}w: p10={p10} p50={p50} p90={p90}"
            )
            band_rows.append(
                {
                    "grade_family": grade_family,
                    "horizon_weeks": band["horizon_weeks"],
                    "p10_inr_mt": p10,
                    "p50_inr_mt": p50,
                    "p90_inr_mt": p90,
                    "coverage_8090": band["coverage_8090"],
                    "pinball": band["pinball"],
                }
            )

    _persist_price_forecasts(run_id, band_rows)

    return {"gradeFamilies": n_succeeded, "bands": len(band_rows), "warnings": warnings}


@router.post("/forecast/price")
async def forecast_price(body: StageRequest) -> dict:
    return await asyncio.to_thread(_forecast_price_sync, body.run_id)


def _persist_recommendations(run_id: str, rows: list[dict]) -> None:
    """Delete-and-rewrite this run_id's recommendations rows (same per-run
    idempotency pattern as demand/price). After the rewrite, any recommendation
    still PENDING from an earlier run is marked EXPIRED — PRD §7: "new runs mark
    undecided older recs EXPIRED"."""
    with psycopg.connect(get_settings().database_url) as conn, conn.cursor() as cur:
        cur.execute("DELETE FROM recommendations WHERE run_id = %s", (run_id,))
        if rows:
            cur.execute("SELECT code, id FROM materials")
            material_ids = dict(cur.fetchall())
            cur.execute("SELECT code, id FROM plants")
            plant_ids = dict(cur.fetchall())

            cur.executemany(
                """
                INSERT INTO recommendations
                    (run_id, material_id, plant_id, play, order_lines, expected_impact,
                     rationale, status)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
                """,
                [
                    (
                        run_id,
                        material_ids[row["material_code"]],
                        plant_ids[row["plant_code"]],
                        row["play"],
                        Jsonb(row["order_lines"]),
                        Jsonb(row["expected_impact"]),
                        Jsonb(row["rationale"]),
                        row["status"],
                    )
                    for row in rows
                ],
            )

        cur.execute(
            "UPDATE recommendations SET status = 'EXPIRED' "
            "WHERE status = 'PENDING' AND run_id != %s",
            (run_id,),
        )


def _recommend_sync(run_id: str) -> dict:
    """F5-AC1/AC3: solve + classify a play for every series this run produced a
    demand forecast for, and persist the resulting E13 rows. Blocking (MILP +
    Monte Carlo + DB I/O) — called via asyncio.to_thread so it never blocks the
    event loop (known pitfall: sync work in async handlers).

    F5-ERR1/ERR3: an ERROR-status series (NO_FEASIBLE_PLAN / SOLVER_TIMEOUT /
    MODEL_INVALID) persists as a recommendation-level error row — `play` NULL,
    `status` ERROR, `rationale.error` carries the code + binding constraints
    (T22 follow-up migration: `recommendation_status` gained ERROR, `play`
    became nullable with a CHECK pairing the two). The run warning is kept
    alongside the row so orchestrator-level tooling sees it without a join.
    """
    materials = load_materials()
    grade_family_by_material = dict(zip(materials["code"], materials["grade_family"], strict=True))

    rec_rows: list[dict] = []
    warnings: list[dict] = []

    for material_code, plant_code in list_series(run_id):
        grade_family = grade_family_by_material.get(material_code)
        try:
            si = assemble_series_inputs(run_id, material_code, plant_code, grade_family)
        except MissingPriceBandError:
            # F5-ERR2: no E11 band for this series' grade_family this run —
            # skip it, warn, keep going; other series are unaffected.
            warnings.append(
                {
                    "code": "MISSING_PRICE_BAND",
                    "material_code": material_code,
                    "plant_code": plant_code,
                    "grade_family": grade_family,
                }
            )
            continue
        except Exception as exc:  # noqa: BLE001 - one bad series must never crash the stage
            warnings.append(
                {
                    "code": "SERIES_FAILED",
                    "material_code": material_code,
                    "plant_code": plant_code,
                    "detail": str(exc),
                }
            )
            continue

        rec = recommend_series(si)

        if rec["status"] == "ERROR":
            # F5-ERR1/ERR3: persist the error row (see docstring) and still
            # warn, so a run-level glance and a recommendations query agree.
            warnings.append(
                {**rec["error"], "material_code": material_code, "plant_code": plant_code}
            )
            rec_rows.append(
                {
                    "material_code": material_code,
                    "plant_code": plant_code,
                    "play": None,
                    "order_lines": [],
                    "expected_impact": {},
                    "rationale": {"error": rec["error"]},
                    "status": "ERROR",
                }
            )
            continue

        rec_rows.append(
            {
                "material_code": material_code,
                "plant_code": plant_code,
                "play": rec["play"],
                "order_lines": rec["orderLines"],
                "expected_impact": rec["expectedImpact"],
                "rationale": rec["rationale"],
                "status": rec["status"],
            }
        )

    _persist_recommendations(run_id, rec_rows)

    return {"recommendations": len(rec_rows), "warnings": warnings}


@router.post("/recommend")
async def recommend(body: StageRequest) -> dict:
    return await asyncio.to_thread(_recommend_sync, body.run_id)


# --------------------------------------------------------------------------- #
# T28 — F7 risk alerts (E15), the final run stage.
# --------------------------------------------------------------------------- #
COVER_BREACH_WINDOW_WEEKS = 4  # F7: "projected within 4 weeks"
BAND_WIDENING_THRESHOLD = HEDGE_SPREAD  # reuse F5's 0.08 band-width constant, don't redefine
PRICE_SPIKE_THRESHOLD = 0.03  # F7: w/w move > 3%; "move" read as absolute (either direction)


def _persist_alerts(run_id: str, rows: list[dict]) -> None:
    """Delete-and-rewrite this run_id's alerts rows — same per-run idempotency
    pattern as demand/price/recommend (PRD §7 invariant)."""
    with psycopg.connect(get_settings().database_url) as conn, conn.cursor() as cur:
        cur.execute("DELETE FROM alerts WHERE run_id = %s", (run_id,))
        if not rows:
            return

        cur.execute("SELECT code, id FROM materials")
        material_ids = dict(cur.fetchall())
        cur.execute("SELECT code, id FROM plants")
        plant_ids = dict(cur.fetchall())

        cur.executemany(
            """
            INSERT INTO alerts
                (run_id, type, severity, material_id, plant_id, payload, status)
            VALUES (%s, %s, %s, %s, %s, %s, 'OPEN')
            """,
            [
                (
                    run_id,
                    row["type"],
                    row["severity"],
                    material_ids[row["material_code"]] if row["material_code"] else None,
                    plant_ids[row["plant_code"]] if row["plant_code"] else None,
                    Jsonb(row["payload"]),
                )
                for row in rows
            ],
        )


def _recommendation_id_for(run_id: str, material_code: str, plant_code: str) -> str | None:
    """This run's recommendation id for a series — links COVER_BREACH -> rec (F7-AC1)."""
    df = query_df(
        """
        SELECT r.id
        FROM recommendations r
        JOIN materials m ON m.id = r.material_id
        JOIN plants p ON p.id = r.plant_id
        WHERE r.run_id = %(run_id)s AND m.code = %(material_code)s AND p.code = %(plant_code)s
        """,
        {"run_id": run_id, "material_code": material_code, "plant_code": plant_code},
    )
    return str(df.iloc[0].id) if not df.empty else None


def _cover_breach_alert(run_id: str, si: SeriesInputs) -> dict | None:
    """COVER_BREACH: CRITICAL if cover is already below the policy floor now,
    WARN if a no-buy simulation projects a breach within the next 4 weeks.
    Reuses rationale._first_projected_breach — the same projection T21 already
    uses to justify a defensive BUY_NOW — rather than re-deriving it here."""
    policy = si.policy
    if si.cover_days < policy.min_cover_days:
        severity, breach_week = "CRITICAL", 0
    else:
        breach_week = _first_projected_breach(si, start_week=1)
        if breach_week is None or breach_week > COVER_BREACH_WINDOW_WEEKS:
            return None
        severity = "WARN"

    return {
        "type": "COVER_BREACH",
        "severity": severity,
        "material_code": si.material_code,
        "plant_code": si.plant_code,
        "payload": {
            "coverDays": round(si.cover_days, 1),
            "minCoverDays": policy.min_cover_days,
            "breachWeek": breach_week,
            "recommendationId": _recommendation_id_for(run_id, si.material_code, si.plant_code),
        },
    }


def _conc_breach_alerts(si: SeriesInputs) -> list[dict]:
    """CONC_BREACH: trailing-90d supplier share > policy cap, per supplier
    (supplier-scoped — PRD §6 F7). Reuses `si.share_denominator`, already
    computed once in SQL by T20's assemble_series_inputs — no duplicate query."""
    denom = si.share_denominator
    if denom.total_mt <= 0:
        return []

    cap_fraction = si.policy.max_supplier_share_pct / 100.0
    alerts: list[dict] = []
    for supplier_code, qty_mt in denom.per_supplier_mt.items():
        share = qty_mt / denom.total_mt
        if share > cap_fraction:
            alerts.append(
                {
                    "type": "CONC_BREACH",
                    "severity": "WARN",
                    "material_code": si.material_code,
                    "plant_code": si.plant_code,
                    "payload": {
                        "supplierCode": supplier_code,
                        "sharePct": round(share * 100, 1),
                        "capPct": si.policy.max_supplier_share_pct,
                        "trailingQtyMt": round(qty_mt, 3),
                        "totalQtyMt": round(denom.total_mt, 3),
                    },
                }
            )
    return alerts


def _band_widening_alerts(run_id: str) -> list[dict]:
    """BAND_WIDENING: (P90-P10)/P50 > 8% at the 4w horizon, per grade_family, on
    this run's own E11 rows. Severity WARN — chosen (not INFO) because >8% at
    4w is the same threshold T21's classifier treats as material enough to be
    HEDGE_LOCK-eligible (recommend/classifier.py HEDGE_SPREAD), so it warrants
    more than an informational flag. Grade-family-scoped: material/plant NULL."""
    df = query_df(
        """
        SELECT grade_family, p10_inr_mt, p50_inr_mt, p90_inr_mt
        FROM price_forecasts
        WHERE run_id = %(run_id)s AND horizon_weeks = 4
        """,
        {"run_id": run_id},
    )
    alerts: list[dict] = []
    for row in df.itertuples():
        spread = (row.p90_inr_mt - row.p10_inr_mt) / row.p50_inr_mt
        if spread > BAND_WIDENING_THRESHOLD:
            alerts.append(
                {
                    "type": "BAND_WIDENING",
                    "severity": "WARN",
                    "material_code": None,
                    "plant_code": None,
                    "payload": {
                        "gradeFamily": row.grade_family,
                        "horizonWeeks": 4,
                        "spreadPct": round(spread * 100, 1),
                        "p10InrMt": int(row.p10_inr_mt),
                        "p50InrMt": int(row.p50_inr_mt),
                        "p90InrMt": int(row.p90_inr_mt),
                    },
                }
            )
    return alerts


def _price_spike_alerts() -> list[dict]:
    """PRICE_SPIKE: latest weekly market index w/w move > 3% per grade_family,
    over committed market_prices (not run-scoped — this is a data-driven alert,
    same source data used by F4's own weekly bucketing)."""
    prices = load_market_prices()
    alerts: list[dict] = []
    if prices.empty:
        return alerts

    for grade_family in sorted(prices["grade_family"].unique()):
        weekly = weekly_prices(prices, grade_family=grade_family)
        if len(weekly) < 2:
            continue
        prev = float(weekly["price_inr_mt"].iloc[-2])
        latest = float(weekly["price_inr_mt"].iloc[-1])
        if prev <= 0:
            continue
        move = (latest - prev) / prev
        if abs(move) > PRICE_SPIKE_THRESHOLD:
            alerts.append(
                {
                    "type": "PRICE_SPIKE",
                    "severity": "WARN",
                    "material_code": None,
                    "plant_code": None,
                    "payload": {
                        "gradeFamily": grade_family,
                        "wowMovePct": round(move * 100, 1),
                        "prevInrMt": int(round(prev)),
                        "latestInrMt": int(round(latest)),
                    },
                }
            )
    return alerts


def _alerts_sync(run_id: str) -> dict:
    """F7-AC1/AC2, F7-ERR2: evaluate all four alert types over committed data +
    this run's outputs, persist E15 rows. A per-series failure never crashes
    the stage — same per-series tolerance as demand/price/recommend."""
    materials = load_materials()
    grade_family_by_material = dict(zip(materials["code"], materials["grade_family"], strict=True))

    alert_rows: list[dict] = []
    warnings: list[dict] = []

    for material_code, plant_code in list_series(run_id):
        grade_family = grade_family_by_material.get(material_code)
        try:
            si = assemble_series_inputs(run_id, material_code, plant_code, grade_family)
        except (MissingPriceBandError, MissingDemandError):
            # Same series already skipped/warned by the recommend stage — no
            # cover/share machinery available for it here either.
            continue
        except Exception as exc:  # noqa: BLE001 - one bad series must never crash the stage
            warnings.append(
                {
                    "code": "SERIES_FAILED",
                    "material_code": material_code,
                    "plant_code": plant_code,
                    "detail": str(exc),
                }
            )
            continue

        cover_alert = _cover_breach_alert(run_id, si)
        if cover_alert:
            alert_rows.append(cover_alert)
        alert_rows.extend(_conc_breach_alerts(si))

    alert_rows.extend(_band_widening_alerts(run_id))
    alert_rows.extend(_price_spike_alerts())

    _persist_alerts(run_id, alert_rows)

    return {"alerts": len(alert_rows), "warnings": warnings}


@router.post("/alerts")
async def alerts(body: StageRequest) -> dict:
    return await asyncio.to_thread(_alerts_sync, body.run_id)
