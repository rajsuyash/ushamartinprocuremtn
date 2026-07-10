"""Tests for the M1 run-stage stubs (T11). Real logic replaces these bodies in
T14 (demand), T17 (price), T22 (recommend) — only the response shape and the
run_id validation contract are load-bearing here.
"""
import pytest
from fastapi.testclient import TestClient
from pdi_engine.main import app

RUN_ID = "11111111-1111-1111-1111-111111111111"


@pytest.fixture
def client():
    """Fixture providing a TestClient for the FastAPI app."""
    return TestClient(app)


@pytest.mark.parametrize(
    ("path", "expected_body"),
    [
        ("/v1/forecast/demand", {"series": 0, "forecasts": 0}),
        ("/v1/forecast/price", {"series": 0, "bands": 0}),
        ("/v1/recommend", {"recommendations": 0}),
    ],
)
def test_stage_stub_returns_zero_work_counts(client, path, expected_body):
    response = client.post(path, json={"run_id": RUN_ID})

    assert response.status_code == 200
    assert response.json() == expected_body


@pytest.mark.parametrize(
    "path",
    ["/v1/forecast/demand", "/v1/forecast/price", "/v1/recommend"],
)
def test_stage_stub_422_on_missing_run_id(client, path):
    response = client.post(path, json={})

    assert response.status_code == 422
