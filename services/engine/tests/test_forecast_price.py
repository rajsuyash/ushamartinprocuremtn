"""Live-DB tests for POST /v1/forecast/price (T17, F4-AC1 persistence).

Mirrors test_forecast_demand.py's pattern: real Run rows via psycopg, driven
through FastAPI's TestClient, asserted against the seeded FIX-2 dataset's 2
grade_family series x 3 horizons. Every test cleans up the runs/price_forecasts
rows it created.
"""
import pdi_engine.api.stages as stages_module
import psycopg
import pytest
from fastapi.testclient import TestClient
from pdi_engine.config import get_settings
from pdi_engine.main import app

N_GRADE_FAMILIES = 2  # seeded FIX-2 grade family count (see test_price_select.py)
HORIZONS_WEEKS = (1, 4, 12)


@pytest.fixture
def client():
    return TestClient(app)


def _create_run() -> str:
    with psycopg.connect(get_settings().database_url) as conn, conn.cursor() as cur:
        cur.execute("INSERT INTO runs DEFAULT VALUES RETURNING id")
        return str(cur.fetchone()[0])


def _delete_run(run_id: str) -> None:
    with psycopg.connect(get_settings().database_url) as conn, conn.cursor() as cur:
        cur.execute("DELETE FROM price_forecasts WHERE run_id = %s", (run_id,))
        cur.execute("DELETE FROM runs WHERE id = %s", (run_id,))


def _fetch_price_rows(run_id: str) -> list[tuple]:
    with psycopg.connect(get_settings().database_url) as conn, conn.cursor() as cur:
        cur.execute(
            """
            SELECT grade_family, horizon_weeks, p10_inr_mt, p50_inr_mt, p90_inr_mt,
                   coverage_8090, pinball
            FROM price_forecasts
            WHERE run_id = %s
            ORDER BY grade_family, horizon_weeks
            """,
            (run_id,),
        )
        return cur.fetchall()


@pytest.fixture
def run_id():
    new_id = _create_run()
    yield new_id
    _delete_run(new_id)


def test_post_forecast_price_persists_two_grade_families_of_three_horizons(client, run_id):
    response = client.post("/v1/forecast/price", json={"run_id": run_id})

    assert response.status_code == 200
    body = response.json()
    assert body["gradeFamilies"] == N_GRADE_FAMILIES
    assert body["bands"] == N_GRADE_FAMILIES * len(HORIZONS_WEEKS)
    assert body["warnings"] == [] or all(
        w["code"] != "BASELINE_FALLBACK" for w in body["warnings"]
    )

    rows = _fetch_price_rows(run_id)
    assert len(rows) == N_GRADE_FAMILIES * len(HORIZONS_WEEKS)

    horizons_per_family: dict[str, list[int]] = {}
    for grade_family, horizon_weeks, p10, p50, p90, _coverage, _pinball in rows:
        assert p10 <= p50 <= p90  # F4 band-order invariant
        horizons_per_family.setdefault(grade_family, []).append(horizon_weeks)

    assert len(horizons_per_family) == N_GRADE_FAMILIES
    for horizons in horizons_per_family.values():
        assert sorted(horizons) == sorted(HORIZONS_WEEKS)


def test_post_forecast_price_is_idempotent_on_repeat(client, run_id):
    first = client.post("/v1/forecast/price", json={"run_id": run_id})
    second = client.post("/v1/forecast/price", json={"run_id": run_id})

    assert first.status_code == 200
    assert second.status_code == 200
    expected = N_GRADE_FAMILIES * len(HORIZONS_WEEKS)
    assert first.json()["bands"] == second.json()["bands"] == expected

    rows = _fetch_price_rows(run_id)
    assert len(rows) == expected


def test_post_forecast_price_422_on_missing_run_id(client):
    response = client.post("/v1/forecast/price", json={})

    assert response.status_code == 422


def test_post_forecast_price_422_on_malformed_run_id(client):
    response = client.post("/v1/forecast/price", json={"run_id": "not-a-uuid"})

    assert response.status_code == 422


def test_post_forecast_price_surfaces_baseline_fallback_and_quantile_repaired_warnings(
    client, run_id, monkeypatch
):
    """F4-ERR1/F4-ERR2 plumbing: whatever `run_grade_family` reports gets
    surfaced onto the stage's `warnings` list (which the web orchestrator
    lifts onto runs.warnings) -- exercised via monkeypatch since FIX-2's real
    grade families have well over the 52-week baseline-fallback threshold."""

    def fake_run_grade_family(_weekly_df):
        return {
            "baseline_fallback": True,
            "quantile_repaired_count": 1,
            "bands": [
                {
                    "horizon_weeks": 1,
                    "p10_inr_mt": 100,
                    "p50_inr_mt": 200,
                    "p90_inr_mt": 300,
                    "coverage_8090": 0.8,
                    "pinball": 1.0,
                }
            ],
        }

    monkeypatch.setattr(stages_module, "run_grade_family", fake_run_grade_family)

    response = client.post("/v1/forecast/price", json={"run_id": run_id})

    assert response.status_code == 200
    codes = [w["code"] for w in response.json()["warnings"]]
    assert "BASELINE_FALLBACK" in codes
    assert "QUANTILE_REPAIRED" in codes
