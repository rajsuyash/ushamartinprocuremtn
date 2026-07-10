"""Tests for the M1 run-stage stubs (T11). `/v1/forecast/demand` got its real
implementation in T14 (see test_forecast_demand.py) and `/v1/forecast/price`
in T17 (see test_forecast_price.py); `recommend` remains an M1 stub here
until T22 lands.
"""
import pytest
from fastapi.testclient import TestClient
from pdi_engine.main import app

RUN_ID = "11111111-1111-1111-1111-111111111111"


@pytest.fixture
def client():
    """Fixture providing a TestClient for the FastAPI app."""
    return TestClient(app)


def test_stage_stub_returns_zero_work_counts(client):
    response = client.post("/v1/recommend", json={"run_id": RUN_ID})

    assert response.status_code == 200
    assert response.json() == {"recommendations": 0}


def test_stage_stub_422_on_missing_run_id(client):
    response = client.post("/v1/recommend", json={})

    assert response.status_code == 422
