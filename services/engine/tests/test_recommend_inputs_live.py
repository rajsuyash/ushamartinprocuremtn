"""Live-DB tests for T20 recommend input assembly against the seeded FIX-2/FIX-3
dataset (DATABASE_URL must point at the seeded engine DB).

- FIX-3 cover: WR-5.5-HC·RNC is a breach (< 21d floor); WR-8-MS·HSP comfortable
  (>= 35d target). Values drift from the seed's headline 18.2/40 because the
  spike A2 denominator is the forward-4-week *forecast* P50, while the seed
  sizes inventory off trailing-8-week *consumption* — asserted within tolerance.
- Share denominator: a fully isolated, hostile fixture (POs straddling the 90d
  po_date window + a wrong-plant PO) with exact numerator/denominator.
- Offers: latest observed unit price per supplier.
"""
from datetime import date, timedelta

import psycopg
import pytest

from pdi_engine.config import get_settings
from pdi_engine.recommend.inputs import (
    assemble_series_inputs,
    load_offers,
    share_denominator,
)


# --- FIX-3 cover scenario --------------------------------------------------- #
def test_fix3_breach_series_cover_below_floor(pipeline_run_id):
    si = assemble_series_inputs(pipeline_run_id, "WR-5.5-HC", "RNC", "WR-STD")
    # The invariant that drives the deterministic BUY_NOW: cover below the floor.
    assert si.cover_days < si.policy.min_cover_days  # < 21
    # Near the seeded 18.2d headline, allowing for the forecast-vs-consumption
    # denominator drift (measured live ~16.6d).
    assert si.cover_days == pytest.approx(18.2, rel=0.20)


def test_fix3_comfortable_series_cover_above_target(pipeline_run_id):
    si = assemble_series_inputs(pipeline_run_id, "WR-8-MS", "HSP", "WR-STD")
    # Comfortable cover -> deterministic WAIT: above the target, far above floor.
    assert si.cover_days >= si.policy.target_cover_days  # >= 35
    assert si.cover_days == pytest.approx(40.0, rel=0.15)  # measured live ~38.9d


def test_fix3_series_inputs_are_well_formed(pipeline_run_id):
    si = assemble_series_inputs(pipeline_run_id, "WR-5.5-HC", "RNC", "WR-STD")
    assert len(si.demand_p50_mt) == 12
    assert len(si.open_po_mt_by_week) == 12
    assert len(si.price_paths.p50) == 12
    assert si.band_4w.horizon_weeks == 4
    assert si.spot_inr_mt > 0
    assert si.offers  # at least one supplier
    # lead_weeks = ceil(lead_days/7): 12->2, 14->2, 45->7
    leads = {o.supplier_code: o.lead_weeks for o in si.offers}
    assert leads["TATA_LP"] == 2
    assert leads["IMPORT_GEN"] == 7


# --- offers: latest price wins ---------------------------------------------- #
def test_offers_pick_latest_observed_price_per_supplier():
    offers = load_offers("WR-5.5-HC")
    by_supplier = {o.supplier_code: o for o in offers}
    # Every FIX-2 supplier that ever priced this material appears exactly once.
    assert set(by_supplier) == {"TATA_LP", "JSW", "IMPORT_GEN"}
    with psycopg.connect(get_settings().database_url) as conn, conn.cursor() as cur:
        for code, offer in by_supplier.items():
            cur.execute(
                """
                SELECT po.unit_price_inr
                FROM purchase_orders po
                JOIN materials m ON m.id = po.material_id
                JOIN suppliers sup ON sup.id = po.supplier_id
                WHERE m.code = 'WR-5.5-HC' AND sup.code = %s
                ORDER BY po.po_date DESC, po.delivery_date DESC, po.po_number DESC
                LIMIT 1
                """,
                (code,),
            )
            assert offer.offer_base_inr == int(cur.fetchone()[0])


# --- hostile, isolated share-denominator test ------------------------------- #
@pytest.fixture
def share_scenario():
    """Insert a throwaway material+plant with POs straddling the 90d window and
    a wrong-plant PO, so the numerator/denominator is fully controlled. Cleaned
    up afterward regardless of outcome."""
    as_of = date(2026, 6, 1)
    window_start = as_of - timedelta(days=90)  # 2026-03-03 (inclusive)
    mat, plant, other_plant = "ZZTEST_MAT", "ZZTEST_PLANT", "ZZTEST_PLANT2"
    conn = psycopg.connect(get_settings().database_url)
    try:
        cur = conn.cursor()
        cur.execute(
            "INSERT INTO materials (code, description, grade_family) VALUES (%s,%s,%s) RETURNING id",
            (mat, "throwaway", "ZZ"),
        )
        mat_id = cur.fetchone()[0]
        plant_ids = {}
        for code in (plant, other_plant):
            cur.execute("INSERT INTO plants (code, name) VALUES (%s,%s) RETURNING id", (code, code))
            plant_ids[code] = cur.fetchone()[0]
        cur.execute("SELECT code, id FROM suppliers")
        sup = dict(cur.fetchall())
        cur.execute("SELECT id FROM upload_batches LIMIT 1")
        batch_id = cur.fetchone()[0]

        # (supplier, plant, po_date, qty) — expected in-window for `plant`:
        #   TATA: 100 + 50 + 5(boundary) = 155 ; JSW: 30 ; total 185
        rows = [
            ("TATA_LP", plant, as_of - timedelta(days=17), 100.0),   # in
            ("TATA_LP", plant, as_of - timedelta(days=61), 50.0),    # in
            ("JSW", plant, as_of - timedelta(days=12), 30.0),        # in
            ("TATA_LP", plant, window_start, 5.0),                   # in (boundary inclusive)
            ("TATA_LP", plant, window_start - timedelta(days=1), 3.0),  # OUT (before window)
            ("JSW", plant, as_of + timedelta(days=14), 888.0),       # OUT (after as_of)
            ("TATA_LP", other_plant, as_of - timedelta(days=10), 777.0),  # OUT (wrong plant)
        ]
        for i, (scode, pcode, po_date, qty) in enumerate(rows):
            cur.execute(
                """
                INSERT INTO purchase_orders
                    (po_number, po_date, supplier_id, material_id, plant_id,
                     qty_mt, unit_price_inr, delivery_date, upload_batch_id)
                VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s)
                """,
                (
                    f"ZZTEST-PO-{i:03d}", po_date, sup[scode], mat_id, plant_ids[pcode],
                    qty, 50000, po_date + timedelta(days=14), batch_id,
                ),
            )
        conn.commit()
        yield {"material": mat, "plant": plant, "as_of": as_of}
    finally:
        cur = conn.cursor()
        cur.execute("DELETE FROM purchase_orders WHERE po_number LIKE 'ZZTEST-PO-%'")
        cur.execute("DELETE FROM materials WHERE code = %s", (mat,))
        cur.execute("DELETE FROM plants WHERE code IN (%s,%s)", (plant, other_plant))
        conn.commit()
        conn.close()


def test_share_denominator_windows_and_scopes_exactly(share_scenario):
    denom = share_denominator(
        share_scenario["material"], share_scenario["plant"], share_scenario["as_of"]
    )
    # Out-of-window (before/after) and wrong-plant POs excluded; boundary included.
    assert denom.per_supplier_mt == {"TATA_LP": 155.0, "JSW": 30.0}
    assert denom.total_mt == pytest.approx(185.0)
