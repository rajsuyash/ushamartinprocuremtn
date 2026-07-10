"""ISO-week (Monday-start) bucketing for consumption and price series.

PRD F3 missing-week rule: a missing week is zero-filled only if the plant
had ANY consumption movement (any material) in that week's calendar month;
weeks in months where the plant had no movement at all are excluded, not
zero-filled.
"""
from datetime import date

import pandas as pd


def _iso_monday(d: date) -> date:
    """Monday date of `d`'s ISO week."""
    iso_year, iso_week, _ = d.isocalendar()
    return date.fromisocalendar(iso_year, iso_week, 1)


def to_iso_weekly(consumption_df: pd.DataFrame) -> pd.DataFrame:
    """Bucket consumption into ISO Monday weeks per material x plant.

    Returns DataFrame(material_code, plant_code, week, qty_mt), sorted by
    (material_code, plant_code, week), one row per week — no duplicates.
    """
    columns = ["material_code", "plant_code", "week", "qty_mt"]
    if consumption_df.empty:
        return pd.DataFrame(columns=columns)

    df = consumption_df.copy()
    df["week"] = df["date"].apply(_iso_monday)
    # ponytail: a week spanning two calendar months is attributed to the
    # month of its Monday — the PRD doesn't define split-week attribution,
    # and this is the simplest deterministic rule. Revisit if a plant's
    # active/inactive boundary ever lands mid-week in real data.
    df["_month"] = df["date"].apply(lambda d: (d.year, d.month))

    weekly = df.groupby(["material_code", "plant_code", "week"], as_index=False)[
        "qty_mt"
    ].sum()

    # (plant, year, month) pairs where the plant had ANY movement (any material).
    active_plant_months = set(df.groupby(["plant_code", "_month"]).indices.keys())

    out_rows = []
    for (material_code, plant_code), group in weekly.groupby(
        ["material_code", "plant_code"]
    ):
        by_week = group.set_index("week")["qty_mt"].sort_index()
        full_weeks = pd.date_range(
            by_week.index.min(), by_week.index.max(), freq="7D"
        ).date
        for week in full_weeks:
            month = (week.year, week.month)
            if (plant_code, month) not in active_plant_months:
                continue  # inactive month -> excluded, never zero-filled
            qty = float(by_week.get(week, 0.0))
            out_rows.append(
                {
                    "material_code": material_code,
                    "plant_code": plant_code,
                    "week": week,
                    "qty_mt": qty,
                }
            )

    if not out_rows:
        return pd.DataFrame(columns=columns)

    return (
        pd.DataFrame(out_rows)
        .sort_values(["material_code", "plant_code", "week"])
        .reset_index(drop=True)
    )


def weekly_prices(
    prices_df: pd.DataFrame, grade_family: str | None = None
) -> pd.DataFrame:
    """Weekly mean price per ISO Monday week, optionally filtered to one grade_family.

    Returns DataFrame(grade_family, week, price_inr_mt), sorted, no duplicate
    (grade_family, week) rows.
    """
    columns = ["grade_family", "week", "price_inr_mt"]
    if prices_df.empty:
        return pd.DataFrame(columns=columns)

    df = prices_df.copy()
    if grade_family is not None:
        df = df[df["grade_family"] == grade_family]
    if df.empty:
        return pd.DataFrame(columns=columns)

    df["week"] = df["date"].apply(_iso_monday)
    return (
        df.groupby(["grade_family", "week"], as_index=False)["price_inr_mt"]
        .mean()
        .sort_values(["grade_family", "week"])
        .reset_index(drop=True)
    )
