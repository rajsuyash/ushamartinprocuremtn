"""Live-DB tests for POST /v1/forecast/demand (T14, F3-AC1 persistence).

Creates real Run rows via psycopg, drives the endpoint through FastAPI's
TestClient, and asserts against the seeded FIX-2 dataset's 6 material x plant
series. Every test cleans up the runs/demand_forecasts rows it created.
"""
from datetime import timedelta

import psycopg
import pytest
from fastapi.testclient import TestClient
from pdi_engine.config import get_settings
from pdi_engine.main import app

VALID_MODELS = {"seasonal_naive", "ets", "lightgbm"}
WAPE_GATE = 0.25  # F3-AC1
N_SERIES = 6  # seeded FIX-2 series count (see test_demand_select.py)
HORIZON_WEEKS = 12


@pytest.fixture
def client():
    return TestClient(app)


def _create_run() -> str:
    with psycopg.connect(get_settings().database_url) as conn, conn.cursor() as cur:
        cur.execute("INSERT INTO runs DEFAULT VALUES RETURNING id")
        return str(cur.fetchone()[0])


def _delete_run(run_id: str) -> None:
    with psycopg.connect(get_settings().database_url) as conn, conn.cursor() as cur:
        cur.execute("DELETE FROM demand_forecasts WHERE run_id = %s", (run_id,))
        cur.execute("DELETE FROM runs WHERE id = %s", (run_id,))


def _fetch_forecast_rows(run_id: str) -> list[tuple]:
    with psycopg.connect(get_settings().database_url) as conn, conn.cursor() as cur:
        cur.execute(
            """
            SELECT material_id, plant_id, week, p50_qty_mt, model, backtest_wape
            FROM demand_forecasts
            WHERE run_id = %s
            ORDER BY material_id, plant_id, week
            """,
            (run_id,),
        )
        return cur.fetchall()


@pytest.fixture
def run_id():
    new_id = _create_run()
    yield new_id
    _delete_run(new_id)


def test_post_forecast_demand_persists_six_series_of_twelve_rows(client, run_id):
    response = client.post("/v1/forecast/demand", json={"run_id": run_id})

    assert response.status_code == 200
    body = response.json()
    assert body["series"] == N_SERIES
    assert body["forecasts"] == N_SERIES * HORIZON_WEEKS
    assert body["warnings"] == []

    rows = _fetch_forecast_rows(run_id)
    assert len(rows) == N_SERIES * HORIZON_WEEKS

    weeks_per_series: dict[tuple, list] = {}
    for material_id, plant_id, week, _p50, model, wape in rows:
        assert model in VALID_MODELS
        assert float(wape) <= WAPE_GATE
        weeks_per_series.setdefault((material_id, plant_id), []).append(week)

    assert len(weeks_per_series) == N_SERIES
    for series_weeks in weeks_per_series.values():
        series_weeks.sort()
        assert len(series_weeks) == HORIZON_WEEKS
        assert series_weeks[0].weekday() == 0  # Monday
        for i in range(1, len(series_weeks)):
            assert series_weeks[i] == series_weeks[i - 1] + timedelta(weeks=1)


def test_post_forecast_demand_is_idempotent_on_repeat(client, run_id):
    first = client.post("/v1/forecast/demand", json={"run_id": run_id})
    second = client.post("/v1/forecast/demand", json={"run_id": run_id})

    assert first.status_code == 200
    assert second.status_code == 200
    assert first.json()["forecasts"] == second.json()["forecasts"] == N_SERIES * HORIZON_WEEKS

    rows = _fetch_forecast_rows(run_id)
    assert len(rows) == N_SERIES * HORIZON_WEEKS


def test_post_forecast_demand_422_on_missing_run_id(client):
    response = client.post("/v1/forecast/demand", json={})

    assert response.status_code == 422


def test_post_forecast_demand_422_on_malformed_run_id(client):
    response = client.post("/v1/forecast/demand", json={"run_id": "not-a-uuid"})

    assert response.status_code == 422


def test_post_forecast_demand_deterministic_p50_across_different_run_ids(client):
    """F3-AC3 at the endpoint layer: two different runs over the same
    committed data produce identical p50 values."""
    run_ids = [_create_run(), _create_run()]
    try:
        for rid in run_ids:
            response = client.post("/v1/forecast/demand", json={"run_id": rid})
            assert response.status_code == 200

        rows_a = _fetch_forecast_rows(run_ids[0])
        rows_b = _fetch_forecast_rows(run_ids[1])

        assert len(rows_a) == len(rows_b) == N_SERIES * HORIZON_WEEKS
        for (m1, p1, w1, q1, *_), (m2, p2, w2, q2, *_) in zip(rows_a, rows_b):
            assert (m1, p1, w1) == (m2, p2, w2)
            assert q1 == q2
    finally:
        for rid in run_ids:
            _delete_run(rid)
