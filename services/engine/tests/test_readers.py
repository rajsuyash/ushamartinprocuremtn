"""Live-DB tests for pdi_engine.data.readers against the seeded FIX-2 dataset."""
from datetime import date

from pdi_engine.data.readers import (
    load_active_policy,
    load_consumption,
    load_inventory_latest,
    load_market_prices,
    load_materials,
    load_open_pos,
    load_plants,
    load_suppliers,
)


def test_load_consumption_returns_expected_columns_and_dtypes():
    df = load_consumption()

    assert not df.empty
    assert list(df.columns) == ["date", "material_code", "plant_code", "qty_mt"]
    assert isinstance(df["date"].iloc[0], date)
    assert df["qty_mt"].dtype.kind == "f"
    assert (df["qty_mt"] > 0).all()


def test_load_consumption_filters_by_material_and_plant():
    all_df = load_consumption()
    material_code = all_df["material_code"].iloc[0]
    plant_code = all_df["plant_code"].iloc[0]

    filtered = load_consumption(material_code=material_code, plant_code=plant_code)

    assert not filtered.empty
    assert (filtered["material_code"] == material_code).all()
    assert (filtered["plant_code"] == plant_code).all()
    assert len(filtered) < len(all_df)


def test_load_market_prices_returns_expected_columns_and_dtypes():
    df = load_market_prices()

    assert not df.empty
    assert list(df.columns) == ["date", "source", "grade_family", "price_inr_mt"]
    assert isinstance(df["date"].iloc[0], date)
    assert df["price_inr_mt"].dtype.kind == "i"
    assert (df["price_inr_mt"] > 0).all()


def test_load_market_prices_filters_by_grade_family():
    all_df = load_market_prices()
    grade_family = all_df["grade_family"].iloc[0]

    filtered = load_market_prices(grade_family=grade_family)

    assert not filtered.empty
    assert (filtered["grade_family"] == grade_family).all()


def test_load_inventory_latest_one_row_per_material_plant():
    df = load_inventory_latest()

    assert not df.empty
    assert list(df.columns) == ["material_code", "plant_code", "as_of_date", "qty_mt"]
    # Exactly one snapshot per (material_code, plant_code): no duplicates.
    assert not df.duplicated(subset=["material_code", "plant_code"]).any()
    assert (df["qty_mt"] >= 0).all()


def test_load_open_pos_only_returns_deliveries_on_or_after_as_of():
    as_of = date(2020, 1, 1)  # before any seeded PO -> should return every PO line

    df = load_open_pos(as_of)

    assert not df.empty
    expected_columns = {
        "po_number",
        "material_code",
        "plant_code",
        "supplier_code",
        "qty_mt",
        "unit_price_inr",
        "po_date",
        "delivery_date",
    }
    assert expected_columns.issubset(df.columns)
    assert (df["delivery_date"] >= as_of).all()


def test_load_open_pos_excludes_deliveries_before_as_of():
    far_future = date(2030, 1, 1)

    df = load_open_pos(far_future)

    assert df.empty


def test_load_materials_plants_suppliers_active_policy_nonempty():
    materials = load_materials()
    plants = load_plants()
    suppliers = load_suppliers()
    policy = load_active_policy()

    assert not materials.empty
    assert list(materials.columns) == ["code", "description", "grade_family", "uom"]

    assert not plants.empty
    assert list(plants.columns) == ["code", "name"]

    assert not suppliers.empty
    assert list(suppliers.columns) == ["code", "name", "type", "lead_time_days"]

    # Exactly one active policy row (DB partial-unique-index constraint, PRD E12).
    assert len(policy) == 1
