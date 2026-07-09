"""Tests for health check endpoint."""
import pytest
from fastapi.testclient import TestClient
from pdi_engine.main import app


@pytest.fixture
def client():
    """Fixture providing a TestClient for the FastAPI app."""
    return TestClient(app)


def test_health_check_success(client, monkeypatch):
    """Test /health returns 200 with connected status when DB is accessible."""
    # Mock the database check to succeed
    async def mock_check_success():
        return True

    monkeypatch.setattr(
        "pdi_engine.main.check_database_connection",
        mock_check_success,
    )

    response = client.get("/health")

    assert response.status_code == 200
    assert response.json() == {"status": "ok", "db": "connected"}


def test_health_check_database_unreachable(client, monkeypatch):
    """Test /health returns 500 when database is unreachable."""
    # Mock the database check to fail
    async def mock_check_failure():
        return False

    monkeypatch.setattr(
        "pdi_engine.main.check_database_connection",
        mock_check_failure,
    )

    response = client.get("/health")

    assert response.status_code == 500
    assert response.json() == {"status": "error", "db": "unreachable"}
