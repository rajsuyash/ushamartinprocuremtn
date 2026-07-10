"""Read-only accessors for engine analytics.

Every reader joins ids -> business codes at the SQL level so downstream
analytics (forecast, price bands, recommendations) work entirely in codes —
no id ever needs to leak past this module.
"""
from datetime import date

import pandas as pd

from .db import query_df


def load_consumption(
    material_code: str | None = None, plant_code: str | None = None
) -> pd.DataFrame:
    """Consumption history as DataFrame(date, material_code, plant_code, qty_mt)."""
    sql = """
        SELECT cr.date AS date,
               m.code AS material_code,
               p.code AS plant_code,
               cr.qty_mt::float AS qty_mt
        FROM consumption_records cr
        JOIN materials m ON m.id = cr.material_id
        JOIN plants p ON p.id = cr.plant_id
        WHERE (%(material_code)s::text IS NULL OR m.code = %(material_code)s)
          AND (%(plant_code)s::text IS NULL OR p.code = %(plant_code)s)
        ORDER BY cr.date
    """
    df = query_df(sql, {"material_code": material_code, "plant_code": plant_code})
    if not df.empty:
        df["date"] = pd.to_datetime(df["date"]).dt.date
        df["qty_mt"] = df["qty_mt"].astype(float)
    return df


def load_market_prices(grade_family: str | None = None) -> pd.DataFrame:
    """Market price points as DataFrame(date, source, grade_family, price_inr_mt)."""
    sql = """
        SELECT date, source, grade_family, price_inr_mt
        FROM market_prices
        WHERE (%(grade_family)s::text IS NULL OR grade_family = %(grade_family)s)
        ORDER BY date
    """
    df = query_df(sql, {"grade_family": grade_family})
    if not df.empty:
        df["date"] = pd.to_datetime(df["date"]).dt.date
        df["price_inr_mt"] = df["price_inr_mt"].astype(int)
    return df


def load_inventory_latest() -> pd.DataFrame:
    """Latest inventory snapshot per material x plant.

    DataFrame(material_code, plant_code, as_of_date, qty_mt).
    """
    sql = """
        SELECT DISTINCT ON (m.code, p.code)
               m.code AS material_code,
               p.code AS plant_code,
               s.as_of_date AS as_of_date,
               s.qty_mt::float AS qty_mt
        FROM inventory_snapshots s
        JOIN materials m ON m.id = s.material_id
        JOIN plants p ON p.id = s.plant_id
        ORDER BY m.code, p.code, s.as_of_date DESC
    """
    df = query_df(sql)
    if not df.empty:
        df["as_of_date"] = pd.to_datetime(df["as_of_date"]).dt.date
        df["qty_mt"] = df["qty_mt"].astype(float)
    return df


def load_open_pos(as_of: date) -> pd.DataFrame:
    """Open PO lines with delivery_date >= as_of.

    DataFrame(po_number, material_code, plant_code, supplier_code, qty_mt,
    unit_price_inr, po_date, delivery_date).
    """
    sql = """
        SELECT po.po_number AS po_number,
               m.code AS material_code,
               p.code AS plant_code,
               sup.code AS supplier_code,
               po.qty_mt::float AS qty_mt,
               po.unit_price_inr AS unit_price_inr,
               po.po_date AS po_date,
               po.delivery_date AS delivery_date
        FROM purchase_orders po
        JOIN materials m ON m.id = po.material_id
        JOIN plants p ON p.id = po.plant_id
        JOIN suppliers sup ON sup.id = po.supplier_id
        WHERE po.delivery_date >= %(as_of)s
        ORDER BY po.delivery_date
    """
    df = query_df(sql, {"as_of": as_of})
    if not df.empty:
        df["qty_mt"] = df["qty_mt"].astype(float)
        df["po_date"] = pd.to_datetime(df["po_date"]).dt.date
        df["delivery_date"] = pd.to_datetime(df["delivery_date"]).dt.date
    return df


def load_materials() -> pd.DataFrame:
    """DataFrame(code, description, grade_family, uom)."""
    return query_df(
        "SELECT code, description, grade_family, uom FROM materials ORDER BY code"
    )


def load_plants() -> pd.DataFrame:
    """DataFrame(code, name)."""
    return query_df("SELECT code, name FROM plants ORDER BY code")


def load_suppliers() -> pd.DataFrame:
    """DataFrame(code, name, type, lead_time_days)."""
    return query_df(
        "SELECT code, name, type, lead_time_days FROM suppliers ORDER BY code"
    )


def load_active_policy() -> pd.DataFrame:
    """The single active policy_configs row (DB enforces at most one).

    DataFrame(min_cover_days, target_cover_days, max_supplier_share_pct,
    service_level_pct, wc_cap_inr).
    """
    return query_df(
        """
        SELECT min_cover_days, target_cover_days, max_supplier_share_pct,
               service_level_pct, wc_cap_inr
        FROM policy_configs
        WHERE is_active = true
        """
    )
