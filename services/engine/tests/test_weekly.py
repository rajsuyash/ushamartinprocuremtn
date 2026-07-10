"""Tests for pdi_engine.data.weekly: ISO Monday-week bucketing.

Live-DB cases exercise the seeded FIX-2 dataset (deterministic per conventions.md);
the missing-week zero-fill vs. exclusion rule is exercised with an inline synthetic
DataFrame so the test doesn't depend on a gap happening to exist in the seed.
"""
from datetime import date

import pandas as pd
import pytest

from pdi_engine.data.readers import load_consumption, load_market_prices
from pdi_engine.data.weekly import to_iso_weekly, weekly_prices


def _consumption_df(rows: list[tuple[str, str, str, float]]) -> pd.DataFrame:
    return pd.DataFrame(
        [
            {
                "date": date.fromisoformat(d),
                "material_code": material,
                "plant_code": plant,
                "qty_mt": qty,
            }
            for d, material, plant, qty in rows
        ]
    )


def test_known_date_lands_in_its_correct_iso_monday_week():
    known_date = date(2024, 3, 6)  # Wednesday
    iso_year, iso_week, _ = known_date.isocalendar()
    expected_monday = date.fromisocalendar(iso_year, iso_week, 1)

    df = _consumption_df([(known_date.isoformat(), "M1", "P1", 10.0)])

    weekly = to_iso_weekly(df)

    assert list(weekly["week"]) == [expected_monday]
    assert weekly["qty_mt"].iloc[0] == 10.0


def test_zero_fill_within_active_month_but_exclude_inactive_month():
    # Plant P1 is active in Jan 2024 (M1 on 01-01, M2 on 01-08 and 01-22) and in
    # March 2024 (M1 on 03-04), but has NO movement at all (any material) in Feb
    # 2024 — Feb's ISO Mondays fall inside M1's overall date range but must be
    # excluded, not zero-filled, per the PRD missing-week rule.
    df = _consumption_df(
        [
            ("2024-01-01", "M1", "P1", 10.0),
            ("2024-01-08", "M2", "P1", 5.0),
            ("2024-01-22", "M2", "P1", 6.0),
            ("2024-03-04", "M1", "P1", 30.0),
        ]
    )

    weekly = to_iso_weekly(df)
    m1 = weekly[(weekly["material_code"] == "M1") & (weekly["plant_code"] == "P1")]
    m1_weeks = dict(zip(m1["week"], m1["qty_mt"]))

    # Every Jan Monday present (Jan is active via M2), zero-filled where M1 itself
    # has no row that week.
    assert m1_weeks[date(2024, 1, 1)] == 10.0
    assert m1_weeks[date(2024, 1, 8)] == 0.0
    assert m1_weeks[date(2024, 1, 15)] == 0.0  # no M1 or M2 row this week either
    assert m1_weeks[date(2024, 1, 22)] == 0.0
    assert m1_weeks[date(2024, 1, 29)] == 0.0

    # No Feb Monday present — plant P1 had zero movement (any material) in Feb.
    feb_weeks = [w for w in m1_weeks if w.month == 2]
    assert feb_weeks == []

    assert m1_weeks[date(2024, 3, 4)] == 30.0


def test_to_iso_weekly_sorted_with_no_duplicate_weeks():
    df = _consumption_df(
        [
            ("2024-01-22", "M1", "P1", 1.0),
            ("2024-01-01", "M1", "P1", 2.0),
            ("2024-01-08", "M1", "P1", 3.0),
        ]
    )

    weekly = to_iso_weekly(df)

    weeks = list(weekly["week"])
    assert weeks == sorted(weeks)
    assert len(weeks) == len(set(weeks))


def test_to_iso_weekly_empty_input_returns_empty_frame():
    empty = pd.DataFrame(columns=["date", "material_code", "plant_code", "qty_mt"])

    weekly = to_iso_weekly(empty)

    assert weekly.empty
    assert list(weekly.columns) == ["material_code", "plant_code", "week", "qty_mt"]


@pytest.mark.parametrize("plant_code", ["RNC", "HSP"])
def test_active_month_from_seed_has_every_iso_week_present(plant_code):
    # FIX-2 consumption is seeded weekly with no gaps (2023-07-10..2026-07-06), so
    # any material x plant month with movement must show every ISO week for that
    # month in the bucketed output — this pins the "present" half of the rule
    # against real data (the exclusion half is covered synthetically above).
    df = load_consumption(plant_code=plant_code)
    weekly = to_iso_weekly(df)
    material_code = df["material_code"].iloc[0]

    series = weekly[
        (weekly["material_code"] == material_code) & (weekly["plant_code"] == plant_code)
    ]
    weeks_present = set(series["week"])

    # Every Monday whose date falls in June 2024.
    expected_mondays = {
        w
        for w in pd.date_range("2024-06-01", "2024-06-30", freq="D").date
        if w.isoweekday() == 1
    }

    assert expected_mondays
    assert expected_mondays.issubset(weeks_present)


def test_weekly_prices_mean_within_fix2_price_band():
    prices = load_market_prices(grade_family="WR-STD")

    weekly = weekly_prices(prices, grade_family="WR-STD")

    assert not weekly.empty
    assert list(weekly.columns) == ["grade_family", "week", "price_inr_mt"]
    assert (weekly["price_inr_mt"] >= 52_000).all()
    assert (weekly["price_inr_mt"] <= 58_000).all()


def test_weekly_prices_sorted_with_no_duplicate_weeks():
    prices = load_market_prices(grade_family="WR-STD")

    weekly = weekly_prices(prices, grade_family="WR-STD")

    weeks = list(weekly["week"])
    assert weeks == sorted(weeks)
    assert len(weeks) == len(set(weeks))


def test_weekly_prices_empty_input_returns_empty_frame():
    empty = pd.DataFrame(columns=["date", "source", "grade_family", "price_inr_mt"])

    weekly = weekly_prices(empty)

    assert weekly.empty
    assert list(weekly.columns) == ["grade_family", "week", "price_inr_mt"]
