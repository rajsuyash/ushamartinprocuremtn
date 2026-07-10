"""Live-DB tests for POST /v1/recommend (T22, F5-AC1/AC3 persistence, F5-ERR2
skip, and the PRD §7 "new runs mark undecided older recs EXPIRED" invariant).

Mirrors test_forecast_demand.py / test_forecast_price.py's pattern: real Run
rows via psycopg, driven through FastAPI's TestClient. Unlike those stages,
`/v1/recommend` reads THIS run's own demand_forecasts/price_forecasts rows (not
committed source tables directly), so every test here runs the demand + price
stages first to give the run something to recommend from.
"""
import pdi_engine.api.stages as stages_module
import psycopg
import pytest
from fastapi.testclient import TestClient
from pdi_engine.config import get_settings
from pdi_engine.main import app
from pdi_engine.recommend.inputs import MissingPriceBandError

FIX3_BUY_NOW = ("WR-5.5-HC", "RNC")  # F5-AC1: cover below floor, rising band
FIX3_WAIT = ("WR-8-MS", "HSP")  # F5-AC3: comfortable cover, flat band


@pytest.fixture
def client():
    return TestClient(app)


def _create_run() -> str:
    with psycopg.connect(get_settings().database_url) as conn, conn.cursor() as cur:
        cur.execute("INSERT INTO runs DEFAULT VALUES RETURNING id")
        return str(cur.fetchone()[0])


def _delete_run(run_id: str) -> None:
    with psycopg.connect(get_settings().database_url) as conn, conn.cursor() as cur:
        cur.execute("DELETE FROM recommendations WHERE run_id = %s", (run_id,))
        cur.execute("DELETE FROM price_forecasts WHERE run_id = %s", (run_id,))
        cur.execute("DELETE FROM demand_forecasts WHERE run_id = %s", (run_id,))
        cur.execute("DELETE FROM runs WHERE id = %s", (run_id,))


def _fetch_recommendations(run_id: str) -> list[dict]:
    with psycopg.connect(get_settings().database_url) as conn, conn.cursor() as cur:
        cur.execute(
            """
            SELECT m.code, p.code, r.play, r.order_lines, r.expected_impact,
                   r.rationale, r.status
            FROM recommendations r
            JOIN materials m ON m.id = r.material_id
            JOIN plants p ON p.id = r.plant_id
            WHERE r.run_id = %s
            ORDER BY m.code, p.code
            """,
            (run_id,),
        )
        cols = [
            "material_code", "plant_code", "play", "order_lines",
            "expected_impact", "rationale", "status",
        ]
        return [dict(zip(cols, row, strict=True)) for row in cur.fetchall()]


def _statuses_for(material_code: str, plant_code: str) -> list[str]:
    with psycopg.connect(get_settings().database_url) as conn, conn.cursor() as cur:
        cur.execute(
            """
            SELECT r.status
            FROM recommendations r
            JOIN materials m ON m.id = r.material_id
            JOIN plants p ON p.id = r.plant_id
            WHERE m.code = %s AND p.code = %s
            """,
            (material_code, plant_code),
        )
        return [row[0] for row in cur.fetchall()]


@pytest.fixture
def run_id():
    new_id = _create_run()
    yield new_id
    _delete_run(new_id)


def _run_pipeline(client: TestClient, run_id: str):
    """Demand -> price -> recommend for a fresh run (recommend needs this run's
    own E10/E11 rows)."""
    assert client.post("/v1/forecast/demand", json={"run_id": run_id}).status_code == 200
    assert client.post("/v1/forecast/price", json={"run_id": run_id}).status_code == 200
    return client.post("/v1/recommend", json={"run_id": run_id})


def test_recommend_persists_fix3_buy_now_and_wait(client, run_id):
    response = _run_pipeline(client, run_id)

    assert response.status_code == 200
    body = response.json()
    assert body["recommendations"] >= 2

    rows = {(r["material_code"], r["plant_code"]): r for r in _fetch_recommendations(run_id)}

    buy_now = rows[FIX3_BUY_NOW]
    assert buy_now["play"] == "BUY_NOW"
    assert buy_now["status"] == "PENDING"
    assert len(buy_now["order_lines"]) >= 1
    assert any(d["factor"] == "COVER_BELOW_FLOOR" for d in buy_now["rationale"]["drivers"])

    wait = rows[FIX3_WAIT]
    assert wait["play"] == "WAIT"
    assert wait["status"] == "PENDING"
    assert wait["order_lines"] == []


def test_recommend_is_idempotent_on_repeat(client, run_id):
    first = _run_pipeline(client, run_id)
    assert first.status_code == 200

    second = client.post("/v1/recommend", json={"run_id": run_id})
    assert second.status_code == 200
    assert first.json()["recommendations"] == second.json()["recommendations"]

    keys = [(r["material_code"], r["plant_code"]) for r in _fetch_recommendations(run_id)]
    assert len(keys) == len(set(keys))  # delete-rewrite, never duplicated


def test_recommend_422_on_missing_run_id(client):
    response = client.post("/v1/recommend", json={})
    assert response.status_code == 422


def test_recommend_422_on_malformed_run_id(client):
    response = client.post("/v1/recommend", json={"run_id": "not-a-uuid"})
    assert response.status_code == 422


def test_recommend_skips_series_missing_price_band(client, run_id, monkeypatch):
    """F5-ERR2: a series whose grade_family has no E11 band this run is skipped
    with a MISSING_PRICE_BAND warning; other series are unaffected."""
    assert client.post("/v1/forecast/demand", json={"run_id": run_id}).status_code == 200
    assert client.post("/v1/forecast/price", json={"run_id": run_id}).status_code == 200

    original = stages_module.assemble_series_inputs

    def fake(run_id_, material_code, plant_code, grade_family):
        if (material_code, plant_code) == FIX3_BUY_NOW:
            raise MissingPriceBandError(grade_family)
        return original(run_id_, material_code, plant_code, grade_family)

    monkeypatch.setattr(stages_module, "assemble_series_inputs", fake)

    response = client.post("/v1/recommend", json={"run_id": run_id})

    assert response.status_code == 200
    body = response.json()
    skipped = [w for w in body["warnings"] if w["code"] == "MISSING_PRICE_BAND"]
    assert len(skipped) == 1
    assert skipped[0]["material_code"] == FIX3_BUY_NOW[0]
    assert skipped[0]["plant_code"] == FIX3_BUY_NOW[1]

    keys = {(r["material_code"], r["plant_code"]) for r in _fetch_recommendations(run_id)}
    assert FIX3_BUY_NOW not in keys  # skipped, never persisted
    assert FIX3_WAIT in keys  # other series still processed


def test_recommend_persists_no_feasible_plan_error_row(client, run_id, monkeypatch):
    """F5-ERR1 integration evidence: a NO_FEASIBLE_PLAN series persists as a
    recommendation-level ERROR row (play NULL) naming the binding constraints,
    not just a run warning."""
    assert client.post("/v1/forecast/demand", json={"run_id": run_id}).status_code == 200
    assert client.post("/v1/forecast/price", json={"run_id": run_id}).status_code == 200

    original = stages_module.recommend_series
    binding_constraints = ["MIN_COVER_21D", "WC_CAP"]

    def fake(si, *args, **kwargs):
        if (si.material_code, si.plant_code) == FIX3_BUY_NOW:
            return {
                "materialCode": si.material_code,
                "plantCode": si.plant_code,
                "play": None,
                "orderLines": [],
                "expectedImpact": None,
                "rationale": None,
                "status": "ERROR",
                "error": {"code": "NO_FEASIBLE_PLAN", "bindingConstraints": binding_constraints},
            }
        return original(si, *args, **kwargs)

    monkeypatch.setattr(stages_module, "recommend_series", fake)

    response = client.post("/v1/recommend", json={"run_id": run_id})

    assert response.status_code == 200
    body = response.json()
    warned = [w for w in body["warnings"] if w["code"] == "NO_FEASIBLE_PLAN"]
    assert len(warned) == 1
    assert warned[0]["bindingConstraints"] == binding_constraints

    rows = {(r["material_code"], r["plant_code"]): r for r in _fetch_recommendations(run_id)}
    error_row = rows[FIX3_BUY_NOW]
    assert error_row["play"] is None
    assert error_row["status"] == "ERROR"
    assert error_row["order_lines"] == []
    assert error_row["rationale"]["error"]["code"] == "NO_FEASIBLE_PLAN"
    assert error_row["rationale"]["error"]["bindingConstraints"] == binding_constraints
    # other series unaffected
    assert rows[FIX3_WAIT]["play"] == "WAIT"


def test_new_run_expires_older_pending_recommendations(client, run_id):
    first = _run_pipeline(client, run_id)
    assert first.status_code == 200
    assert _statuses_for(*FIX3_BUY_NOW) == ["PENDING"]

    second_run_id = _create_run()
    try:
        second = _run_pipeline(client, second_run_id)
        assert second.status_code == 200

        statuses = sorted(_statuses_for(*FIX3_BUY_NOW))
        assert statuses == ["EXPIRED", "PENDING"]

        old_row = next(
            r for r in _fetch_recommendations(run_id)
            if (r["material_code"], r["plant_code"]) == FIX3_BUY_NOW
        )
        assert old_row["status"] == "EXPIRED"
    finally:
        _delete_run(second_run_id)
