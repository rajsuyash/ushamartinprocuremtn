"""Pytest configuration for PDI engine tests."""
import os
import sys
from pathlib import Path

import pytest

# Add src directory to Python path for imports
src_path = Path(__file__).parent.parent / "src"
sys.path.insert(0, str(src_path))


@pytest.fixture(scope="session")
def pipeline_run_id():
    """A DONE run with demand + price forecasts persisted, for live recommend tests.

    The seed loads raw data only; recommend-layer tests need this-run E10/E11 rows.
    Bootstraps the pipeline once per session and cleans up its rows afterwards.
    """
    if not os.environ.get("DATABASE_URL"):
        pytest.skip("DATABASE_URL not set")

    import psycopg
    from fastapi.testclient import TestClient
    from pdi_engine.config import get_settings
    from pdi_engine.main import app

    with psycopg.connect(get_settings().database_url) as conn, conn.cursor() as cur:
        cur.execute("INSERT INTO runs DEFAULT VALUES RETURNING id")
        run_id = str(cur.fetchone()[0])

    client = TestClient(app)
    for stage in ("demand", "price"):
        response = client.post(f"/v1/forecast/{stage}", json={"run_id": run_id})
        assert response.status_code == 200, f"pipeline bootstrap {stage} failed: {response.text}"

    with psycopg.connect(get_settings().database_url) as conn, conn.cursor() as cur:
        cur.execute("UPDATE runs SET status = 'DONE', finished_at = now() WHERE id = %s", (run_id,))

    yield run_id

    with psycopg.connect(get_settings().database_url) as conn, conn.cursor() as cur:
        cur.execute("DELETE FROM recommendations WHERE run_id = %s", (run_id,))
        cur.execute("DELETE FROM price_forecasts WHERE run_id = %s", (run_id,))
        cur.execute("DELETE FROM demand_forecasts WHERE run_id = %s", (run_id,))
        cur.execute("DELETE FROM runs WHERE id = %s", (run_id,))
