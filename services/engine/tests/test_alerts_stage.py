"""T28 — POST /v1/alerts tests (F7 risk alerts, E15 persistence).

Two layers, mirroring test_recommend_stage.py / test_recommend_solver.py:
  - Live-DB integration tests drive the full demand -> price -> recommend ->
    alerts pipeline through FastAPI's TestClient against the seeded FIX-2/FIX-3
    dataset (F7-AC1, idempotency, error-envelope, F7-ERR2 zero-alert case).
  - Threshold unit tests call the pure per-type helpers directly on synthetic
    SeriesInputs (mirrors test_recommend_solver.py's `make_inputs` builder) so
    each trigger's above/below boundary is asserted without depending on the
    live dataset's exact numbers.
"""
from datetime import date

import psycopg
import pytest
from fastapi.testclient import TestClient
from pdi_engine.config import get_settings
from pdi_engine.main import app
from pdi_engine.recommend.inputs import (
    PolicyInputs,
    PriceBand,
    PricePaths,
    SeriesInputs,
    ShareDenominator,
    SupplierOffer,
)

import pdi_engine.api.stages as stages_module
from pdi_engine.api.stages import (
    _band_widening_alerts,
    _conc_breach_alerts,
    _cover_breach_alert,
    _price_spike_alerts,
)

FIX3_BUY_NOW = ("WR-5.5-HC", "RNC")  # F5-AC1/F7-AC1: cover below floor, rising band
FIX3_WAIT = ("WR-8-MS", "HSP")  # comfortable cover, flat band

DEFAULT_POLICY = PolicyInputs(
    min_cover_days=21,
    target_cover_days=35,
    max_supplier_share_pct=60.0,
    service_level_pct=95.0,
    wc_cap_inr=None,
)
TWO_SUPPLIERS = [
    SupplierOffer(supplier_code="S1", offer_base_inr=50000, lead_time_days=7, lead_weeks=1),
    SupplierOffer(supplier_code="S2", offer_base_inr=51000, lead_time_days=7, lead_weeks=1),
]


def make_inputs(
    *,
    on_hand: float,
    demand: list[float] | None = None,
    denom: ShareDenominator | None = None,
    policy: PolicyInputs = DEFAULT_POLICY,
    spot: int = 54000,
    band4: PriceBand | None = None,
    open_po: list[float] | None = None,
) -> SeriesInputs:
    """Mirrors test_recommend_solver.py's make_inputs — a synthetic SeriesInputs
    builder so alert-threshold tests pin exactly the cover/share pressure they need."""
    demand = demand or [100.0] * 12
    denom = denom or ShareDenominator(per_supplier_mt={"S1": 5000.0, "S2": 5000.0}, total_mt=10000.0)
    band4 = band4 or PriceBand(horizon_weeks=4, p10_inr_mt=53000, p50_inr_mt=54000, p90_inr_mt=55000)
    add1 = sum(demand[:4]) / 28
    return SeriesInputs(
        material_code="M",
        plant_code="P",
        grade_family="G",
        as_of=date(2026, 7, 6),
        on_hand_mt=on_hand,
        demand_p50_mt=demand,
        open_po_mt_by_week=open_po or [0.0] * 12,
        cover_days=on_hand / add1,
        avg_daily_demand_mt=add1,
        spot_inr_mt=spot,
        price_paths=PricePaths(p10=[spot] * 12, p50=[spot] * 12, p90=[spot] * 12),
        band_4w=band4,
        offers=TWO_SUPPLIERS,
        share_denominator=denom,
        policy=policy,
    )


@pytest.fixture
def client():
    return TestClient(app)


def _create_run() -> str:
    with psycopg.connect(get_settings().database_url) as conn, conn.cursor() as cur:
        cur.execute("INSERT INTO runs DEFAULT VALUES RETURNING id")
        return str(cur.fetchone()[0])


def _delete_run(run_id: str) -> None:
    with psycopg.connect(get_settings().database_url) as conn, conn.cursor() as cur:
        cur.execute("DELETE FROM alerts WHERE run_id = %s", (run_id,))
        cur.execute("DELETE FROM recommendations WHERE run_id = %s", (run_id,))
        cur.execute("DELETE FROM price_forecasts WHERE run_id = %s", (run_id,))
        cur.execute("DELETE FROM demand_forecasts WHERE run_id = %s", (run_id,))
        cur.execute("DELETE FROM runs WHERE id = %s", (run_id,))


def _fetch_alerts(run_id: str) -> list[dict]:
    with psycopg.connect(get_settings().database_url) as conn, conn.cursor() as cur:
        cur.execute(
            """
            SELECT a.type, a.severity, m.code, p.code, a.payload, a.status
            FROM alerts a
            LEFT JOIN materials m ON m.id = a.material_id
            LEFT JOIN plants p ON p.id = a.plant_id
            WHERE a.run_id = %s
            """,
            (run_id,),
        )
        cols = ["type", "severity", "material_code", "plant_code", "payload", "status"]
        return [dict(zip(cols, row, strict=True)) for row in cur.fetchall()]


def _fetch_recommendation_id(material_code: str, plant_code: str, run_id: str) -> str:
    with psycopg.connect(get_settings().database_url) as conn, conn.cursor() as cur:
        cur.execute(
            """
            SELECT r.id
            FROM recommendations r
            JOIN materials m ON m.id = r.material_id
            JOIN plants p ON p.id = r.plant_id
            WHERE r.run_id = %s AND m.code = %s AND p.code = %s
            """,
            (run_id, material_code, plant_code),
        )
        return str(cur.fetchone()[0])


@pytest.fixture
def run_id():
    new_id = _create_run()
    yield new_id
    _delete_run(new_id)


def _run_pipeline(client: TestClient, run_id: str):
    assert client.post("/v1/forecast/demand", json={"run_id": run_id}).status_code == 200
    assert client.post("/v1/forecast/price", json={"run_id": run_id}).status_code == 200
    assert client.post("/v1/recommend", json={"run_id": run_id}).status_code == 200
    return client.post("/v1/alerts", json={"run_id": run_id})


# --------------------------------------------------------------------------- #
# Live-DB integration (F7-AC1, idempotency, F7-ERR2)
# --------------------------------------------------------------------------- #
def test_alerts_persists_fix3_cover_breach_critical_linked_to_recommendation(client, run_id):
    response = _run_pipeline(client, run_id)

    assert response.status_code == 200
    assert response.json()["alerts"] >= 1

    rows = _fetch_alerts(run_id)
    cover_alerts = {
        (r["material_code"], r["plant_code"]): r for r in rows if r["type"] == "COVER_BREACH"
    }
    fix3 = cover_alerts[FIX3_BUY_NOW]
    assert fix3["severity"] == "CRITICAL"
    assert fix3["status"] == "OPEN"
    assert fix3["payload"]["coverDays"] < fix3["payload"]["minCoverDays"]

    rec_id = _fetch_recommendation_id(*FIX3_BUY_NOW, run_id)
    assert fix3["payload"]["recommendationId"] == rec_id


def test_alerts_is_idempotent_on_repeat(client, run_id):
    first = _run_pipeline(client, run_id)
    assert first.status_code == 200

    second = client.post("/v1/alerts", json={"run_id": run_id})
    assert second.status_code == 200
    assert first.json()["alerts"] == second.json()["alerts"]

    rows = _fetch_alerts(run_id)
    assert len(rows) == first.json()["alerts"]  # delete-rewrite, never duplicated


def test_alerts_422_on_missing_run_id(client):
    response = client.post("/v1/alerts", json={})
    assert response.status_code == 422


def test_alerts_422_on_malformed_run_id(client):
    response = client.post("/v1/alerts", json={"run_id": "not-a-uuid"})
    assert response.status_code == 422


def test_alerts_zero_when_no_conditions_met(client, run_id, monkeypatch):
    """F7-ERR2: a run where no alert conditions fire persists zero rows and
    does not crash."""
    monkeypatch.setattr(stages_module, "_cover_breach_alert", lambda run_id, si: None)
    monkeypatch.setattr(stages_module, "_conc_breach_alerts", lambda si: [])
    monkeypatch.setattr(stages_module, "_band_widening_alerts", lambda run_id: [])
    monkeypatch.setattr(stages_module, "_price_spike_alerts", lambda: [])

    response = _run_pipeline(client, run_id)

    assert response.status_code == 200
    assert response.json()["alerts"] == 0
    assert _fetch_alerts(run_id) == []


# --------------------------------------------------------------------------- #
# Threshold unit tests — synthetic series above/below each trigger
# --------------------------------------------------------------------------- #
def test_cover_breach_critical_when_already_below_floor():
    si = make_inputs(on_hand=200.0)  # add1=100/28*4... cover well under 21d floor
    alert = _cover_breach_alert("00000000-0000-0000-0000-000000000000", si)
    assert alert is not None
    assert alert["severity"] == "CRITICAL"
    assert alert["payload"]["breachWeek"] == 0


def test_cover_breach_warn_when_breach_projected_within_window():
    # Comfortable now (cover >= floor) but demand ramps hard after week 1,
    # driving on-hand below the rising floor within the 4-week window.
    si = make_inputs(on_hand=900.0, demand=[100.0] * 2 + [400.0] * 10)
    assert si.cover_days >= si.policy.min_cover_days  # comfortable at t=0
    alert = _cover_breach_alert("00000000-0000-0000-0000-000000000000", si)
    assert alert is not None
    assert alert["severity"] == "WARN"
    assert 1 <= alert["payload"]["breachWeek"] <= 4


def test_cover_breach_none_when_comfortable_and_no_projected_breach():
    si = make_inputs(on_hand=10_000.0, demand=[100.0] * 12)  # far above any floor throughout
    alert = _cover_breach_alert("00000000-0000-0000-0000-000000000000", si)
    assert alert is None


def test_conc_breach_flags_supplier_over_cap():
    denom = ShareDenominator(per_supplier_mt={"S1": 700.0, "S2": 300.0}, total_mt=1000.0)
    si = make_inputs(on_hand=10_000.0, denom=denom)  # S1 share = 70% > 60% cap
    alerts = _conc_breach_alerts(si)
    assert len(alerts) == 1
    assert alerts[0]["type"] == "CONC_BREACH"
    assert alerts[0]["severity"] == "WARN"
    assert alerts[0]["payload"]["supplierCode"] == "S1"
    assert alerts[0]["payload"]["sharePct"] == 70.0


def test_conc_breach_empty_when_within_cap():
    denom = ShareDenominator(per_supplier_mt={"S1": 500.0, "S2": 500.0}, total_mt=1000.0)
    si = make_inputs(on_hand=10_000.0, denom=denom)  # 50/50, both under 60% cap
    assert _conc_breach_alerts(si) == []


def test_conc_breach_empty_when_no_trailing_purchases():
    denom = ShareDenominator(per_supplier_mt={}, total_mt=0.0)
    si = make_inputs(on_hand=10_000.0, denom=denom)
    assert _conc_breach_alerts(si) == []


def test_band_widening_flags_wide_spread_at_4w(run_id):
    with psycopg.connect(get_settings().database_url) as conn, conn.cursor() as cur:
        cur.execute(
            """
            INSERT INTO price_forecasts
                (run_id, grade_family, horizon_weeks, p10_inr_mt, p50_inr_mt, p90_inr_mt)
            VALUES (%s, 'WR-STD', 4, 50000, 54000, 60000)
            """,
            (run_id,),
        )  # (60000-50000)/54000 = 18.5% > 8% threshold
    alerts = _band_widening_alerts(run_id)
    assert len(alerts) == 1
    assert alerts[0]["type"] == "BAND_WIDENING"
    assert alerts[0]["severity"] == "WARN"
    assert alerts[0]["material_code"] is None  # grade-family scoped, not material-scoped
    assert alerts[0]["payload"]["gradeFamily"] == "WR-STD"


def test_band_widening_empty_when_narrow_spread(run_id):
    with psycopg.connect(get_settings().database_url) as conn, conn.cursor() as cur:
        cur.execute(
            """
            INSERT INTO price_forecasts
                (run_id, grade_family, horizon_weeks, p10_inr_mt, p50_inr_mt, p90_inr_mt)
            VALUES (%s, 'WR-STD', 4, 53500, 54000, 54500)
            """,
            (run_id,),
        )  # (54500-53500)/54000 = 1.9% < 8% threshold
    assert _band_widening_alerts(run_id) == []


def test_price_spike_flags_large_wow_move(monkeypatch):
    import pandas as pd

    fake_prices = pd.DataFrame(
        {
            "date": [date(2026, 6, 22), date(2026, 6, 29)],
            "source": ["S", "S"],
            "grade_family": ["WR-STD", "WR-STD"],
            "price_inr_mt": [54000, 56500],  # +4.6% w/w
        }
    )
    monkeypatch.setattr(stages_module, "load_market_prices", lambda: fake_prices)

    alerts = _price_spike_alerts()
    assert len(alerts) == 1
    assert alerts[0]["type"] == "PRICE_SPIKE"
    assert alerts[0]["severity"] == "WARN"
    assert alerts[0]["payload"]["gradeFamily"] == "WR-STD"
    assert alerts[0]["payload"]["wowMovePct"] > 3.0


def test_price_spike_empty_when_move_within_threshold(monkeypatch):
    import pandas as pd

    fake_prices = pd.DataFrame(
        {
            "date": [date(2026, 6, 22), date(2026, 6, 29)],
            "source": ["S", "S"],
            "grade_family": ["WR-STD", "WR-STD"],
            "price_inr_mt": [54000, 54500],  # +0.9% w/w
        }
    )
    monkeypatch.setattr(stages_module, "load_market_prices", lambda: fake_prices)

    assert _price_spike_alerts() == []
