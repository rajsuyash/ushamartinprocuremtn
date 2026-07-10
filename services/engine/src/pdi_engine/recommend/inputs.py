"""T20 — input assembly for the F5 recommendation solver (T21).

Per material x plant, this layer gathers everything the CP-SAT solver needs and
returns it as typed pydantic v2 models. It performs NO optimization — it reads
committed data + this run's E10/E11 rows, computes cover, buckets open POs by
delivery week, loads supplier offers + policy, and runs the trailing-90d share
denominator as a single SQL query (pitfall: computed once, in SQL).

Spec: docs/execution-plan/milp-formulation.md §0, §1.6, §3, §2.4. ASSUMPTIONs
carried through from that spike:
- A2: cover denominator = forward 4-week mean daily demand (tail-clamped).
- A3: trailing-90d share keyed on po_date, scoped to material x plant.
- A5: supplier offer delta = 0 in v1 (offer = latest observed unit price).

Units: money = integer INR/MT; quantities = MT (float, numeric(12,3)). Weeks
are ISO-Monday; week 0 = the inventory snapshot's as_of week, weeks 1..12 are
the forecast horizon (E10 rows already start at as_of + 1 week).
"""
from __future__ import annotations

from datetime import date
from math import ceil

from pydantic import BaseModel

from ..data.db import query_df
from ..data.readers import (
    load_active_policy,
    load_inventory_latest,
    load_market_prices,
    load_open_pos,
)

HORIZON_WEEKS = 12
COVER_WINDOW_WEEKS = 4  # spike A2: forward 4-week mean daily demand
DAYS_PER_WEEK = 7
BAND_HORIZONS = (1, 4, 12)  # E11 anchors; week 0 anchor = spot


# --------------------------------------------------------------------------- #
# Typed models (the solver's input contract)
# --------------------------------------------------------------------------- #
class PolicyInputs(BaseModel):
    """The single active PolicyConfig (E12), typed."""

    min_cover_days: int
    target_cover_days: int
    max_supplier_share_pct: float
    service_level_pct: float
    wc_cap_inr: int | None


class SupplierOffer(BaseModel):
    """Latest observed supplier price for a material + its lead time.

    `offer_base_inr` = latest observed unit_price_inr (delta = 0, A5).
    `lead_weeks` = ceil(lead_time_days / 7) — the order->arrival lag in weeks.
    """

    supplier_code: str
    offer_base_inr: int
    lead_time_days: int
    lead_weeks: int


class ShareDenominator(BaseModel):
    """Trailing-90d committed PO qty per supplier + the total, for one
    material x plant (spike §1.6). Numerator/denominator for the share cap."""

    per_supplier_mt: dict[str, float]
    total_mt: float


class PriceBand(BaseModel):
    """One E11 band row (a single horizon)."""

    horizon_weeks: int
    p10_inr_mt: int
    p50_inr_mt: int
    p90_inr_mt: int


class PricePaths(BaseModel):
    """Per-week (t=1..12) interpolated price quantile curves (spike §3).

    Week 0 is anchored at `spot` for every quantile (price is known at t=0, so
    the band has zero width there); horizons 1/4/12 anchor the E11 quantiles;
    intermediate weeks are piecewise-linear.
    """

    p10: list[int]
    p50: list[int]
    p90: list[int]


class CoverState(BaseModel):
    """Cover at horizon start + committed arrivals bucketed by delivery week."""

    on_hand_mt: float
    avg_daily_demand_mt: float
    cover_days: float
    open_po_mt_by_week: list[float]  # len 12, index i = week t=i+1


class SeriesInputs(BaseModel):
    """Everything the T21 solver consumes for one material x plant series."""

    material_code: str
    plant_code: str
    grade_family: str
    as_of: date
    on_hand_mt: float
    demand_p50_mt: list[float]  # len 12, weeks 1..12
    open_po_mt_by_week: list[float]  # len 12
    cover_days: float
    avg_daily_demand_mt: float
    spot_inr_mt: int
    price_paths: PricePaths
    band_4w: PriceBand
    offers: list[SupplierOffer]
    share_denominator: ShareDenominator
    policy: PolicyInputs


class MissingPriceBandError(Exception):
    """F5-ERR2: the series' grade_family has no E11 band this run — the series
    is skipped with a run warning, never solved."""

    def __init__(self, grade_family: str) -> None:
        super().__init__(f"MISSING_PRICE_BAND: {grade_family}")
        self.grade_family = grade_family


class MissingDemandError(Exception):
    """No E10 demand rows for the series this run (excluded upstream as
    INSUFFICIENT_HISTORY) — the assembler must not be called for it."""

    def __init__(self, material_code: str, plant_code: str) -> None:
        super().__init__(f"MISSING_DEMAND: {material_code} {plant_code}")
        self.material_code = material_code
        self.plant_code = plant_code


# --------------------------------------------------------------------------- #
# Pure computation (no DB) — unit-testable in isolation
# --------------------------------------------------------------------------- #
def _iso_monday(d: date) -> date:
    iso_year, iso_week, _ = d.isocalendar()
    return date.fromisocalendar(iso_year, iso_week, 1)


def forward_avg_daily_demand(
    demand_mt: list[float], t: int, window: int = COVER_WINDOW_WEEKS
) -> float:
    """Spike A2: avg daily demand over the forward `window` weeks starting at
    week `t` (1-indexed), tail-clamped to the horizon end. Returns MT/day.

    add[t] = ( sum_{k=t}^{min(t+window-1, H)} d[k] ) / ( 7 x weeks_in_window ).
    """
    if not demand_mt:
        raise ValueError("demand_mt is empty")
    start = t - 1  # to 0-indexed
    end = min(start + window, len(demand_mt))  # exclusive, tail-clamped
    weeks = end - start
    if weeks <= 0:
        raise ValueError(f"no demand weeks in window at t={t}")
    return sum(demand_mt[start:end]) / (DAYS_PER_WEEK * weeks)


def compute_cover(on_hand_mt: float, demand_p50_mt: list[float]) -> CoverState:
    """cover[0] = I0 / add[1] (spike §2.4). Open POs are attached separately by
    the caller — at week 0 no arrivals have landed, so reported cover is
    on-hand-only, which is exactly the FIX-3 breach metric (18.2d)."""
    add1 = forward_avg_daily_demand(demand_p50_mt, t=1)
    cover_days = on_hand_mt / add1 if add1 > 0 else float("inf")
    return CoverState(
        on_hand_mt=on_hand_mt,
        avg_daily_demand_mt=add1,
        cover_days=cover_days,
        open_po_mt_by_week=[0.0] * HORIZON_WEEKS,
    )


def bucket_open_pos_by_week(
    delivery_dates_qty: list[tuple[date, float]], as_of: date
) -> list[float]:
    """Bucket committed PO arrivals into horizon weeks 1..12 (spike §1.3).

    Week offset t = ISO-Monday(delivery) - ISO-Monday(as_of), in whole weeks.
    A PO delivering in week 3 lands in week 3 (index 2), never week 0. Arrivals
    beyond week 12 are dropped (A1: only in-horizon arrivals help cover). A
    same-week delivery (t=0, but delivery_date >= as_of) is folded to week 1
    rather than lost — committed steel must count toward cover.
    """
    weeks = [0.0] * HORIZON_WEEKS
    as_of_monday = _iso_monday(as_of)
    for delivery_date, qty in delivery_dates_qty:
        offset = (_iso_monday(delivery_date) - as_of_monday).days // DAYS_PER_WEEK
        t = max(1, offset)
        if 1 <= t <= HORIZON_WEEKS:
            weeks[t - 1] += qty
    return weeks


def interpolate_path(spot: int, anchors: dict[int, int]) -> list[int]:
    """Piecewise-linear interpolation of a price quantile across weeks 1..12,
    through anchors (0->spot, 1->a1, 4->a4, 12->a12) (spike §3). Rounded to
    integer INR/MT."""
    points = sorted({0: spot, **anchors}.items())  # [(week, value), ...]
    out: list[int] = []
    for t in range(1, HORIZON_WEEKS + 1):
        # locate the bracketing anchor pair (t is always <= last anchor week=12)
        lo = max(w for w, _ in points if w <= t)
        hi = min((w for w, _ in points if w >= t), default=lo)
        v_lo = dict(points)[lo]
        v_hi = dict(points)[hi]
        if hi == lo:
            out.append(int(round(v_hi)))
        else:
            frac = (t - lo) / (hi - lo)
            out.append(int(round(v_lo + frac * (v_hi - v_lo))))
    return out


def build_price_paths(spot: int, bands: dict[int, PriceBand]) -> PricePaths:
    """Interpolate p10/p50/p90 weekly curves from the 3-horizon E11 bands."""
    return PricePaths(
        p10=interpolate_path(spot, {h: bands[h].p10_inr_mt for h in BAND_HORIZONS}),
        p50=interpolate_path(spot, {h: bands[h].p50_inr_mt for h in BAND_HORIZONS}),
        p90=interpolate_path(spot, {h: bands[h].p90_inr_mt for h in BAND_HORIZONS}),
    )


# --------------------------------------------------------------------------- #
# DB readers (this run's E10/E11 + committed data)
# --------------------------------------------------------------------------- #
def load_demand_p50(run_id: str, material_code: str, plant_code: str) -> list[float]:
    """This run's 12 weekly P50 demand values (MT) for one series, week-ordered.

    Raises MissingDemandError when the series produced no E10 rows (excluded
    upstream as INSUFFICIENT_HISTORY)."""
    df = query_df(
        """
        SELECT df.week AS week, df.p50_qty_mt::float AS p50_qty_mt
        FROM demand_forecasts df
        JOIN materials m ON m.id = df.material_id
        JOIN plants p ON p.id = df.plant_id
        WHERE df.run_id = %(run_id)s AND m.code = %(material_code)s
          AND p.code = %(plant_code)s
        ORDER BY df.week
        """,
        {"run_id": run_id, "material_code": material_code, "plant_code": plant_code},
    )
    if df.empty:
        raise MissingDemandError(material_code, plant_code)
    return [float(v) for v in df["p50_qty_mt"]]


def load_price_bands(run_id: str, grade_family: str) -> dict[int, PriceBand]:
    """This run's E11 bands for a grade_family, keyed by horizon_weeks.

    Raises MissingPriceBandError (F5-ERR2) when no band exists for the family."""
    df = query_df(
        """
        SELECT horizon_weeks, p10_inr_mt, p50_inr_mt, p90_inr_mt
        FROM price_forecasts
        WHERE run_id = %(run_id)s AND grade_family = %(grade_family)s
        ORDER BY horizon_weeks
        """,
        {"run_id": run_id, "grade_family": grade_family},
    )
    bands = {
        int(r.horizon_weeks): PriceBand(
            horizon_weeks=int(r.horizon_weeks),
            p10_inr_mt=int(r.p10_inr_mt),
            p50_inr_mt=int(r.p50_inr_mt),
            p90_inr_mt=int(r.p90_inr_mt),
        )
        for r in df.itertuples()
    }
    if not all(h in bands for h in BAND_HORIZONS):
        raise MissingPriceBandError(grade_family)
    return bands


def load_offers(material_code: str) -> list[SupplierOffer]:
    """Latest observed unit price per supplier for `material_code`, with lead
    time (spike §0/§3, A5 delta=0). One row per supplier via DISTINCT ON with a
    deterministic tie-break (latest po_date, then delivery_date, then po_number).
    """
    df = query_df(
        """
        SELECT DISTINCT ON (sup.code)
               sup.code AS supplier_code,
               po.unit_price_inr AS offer_base_inr,
               sup.lead_time_days AS lead_time_days
        FROM purchase_orders po
        JOIN materials m ON m.id = po.material_id
        JOIN suppliers sup ON sup.id = po.supplier_id
        WHERE m.code = %(material_code)s
        ORDER BY sup.code, po.po_date DESC, po.delivery_date DESC, po.po_number DESC
        """,
        {"material_code": material_code},
    )
    return [
        SupplierOffer(
            supplier_code=r.supplier_code,
            offer_base_inr=int(r.offer_base_inr),
            lead_time_days=int(r.lead_time_days),
            lead_weeks=ceil(int(r.lead_time_days) / DAYS_PER_WEEK),
        )
        for r in df.itertuples()
    ]


def share_denominator(
    material_code: str, plant_code: str, as_of: date
) -> ShareDenominator:
    """Trailing-90d committed PO qty per supplier + total for one material x
    plant, in ONE SQL query (spike §1.6, pitfall: computed once in SQL). Window
    keyed on po_date in [as_of - 90d, as_of] (A3)."""
    df = query_df(
        """
        SELECT sup.code AS supplier_code, SUM(po.qty_mt)::float AS qty_mt
        FROM purchase_orders po
        JOIN materials m ON m.id = po.material_id
        JOIN plants p ON p.id = po.plant_id
        JOIN suppliers sup ON sup.id = po.supplier_id
        WHERE m.code = %(material_code)s AND p.code = %(plant_code)s
          AND po.po_date >= %(as_of)s - INTERVAL '90 days'
          AND po.po_date <= %(as_of)s
        GROUP BY sup.code
        """,
        {"material_code": material_code, "plant_code": plant_code, "as_of": as_of},
    )
    per_supplier = {r.supplier_code: float(r.qty_mt) for r in df.itertuples()}
    return ShareDenominator(
        per_supplier_mt=per_supplier,
        total_mt=float(sum(per_supplier.values())),
    )


def load_policy() -> PolicyInputs:
    """The single active PolicyConfig row, typed."""
    df = load_active_policy()
    if df.empty:
        raise ValueError("no active policy_config row")
    row = df.iloc[0]
    wc = row["wc_cap_inr"]
    return PolicyInputs(
        min_cover_days=int(row["min_cover_days"]),
        target_cover_days=int(row["target_cover_days"]),
        max_supplier_share_pct=float(row["max_supplier_share_pct"]),
        service_level_pct=float(row["service_level_pct"]),
        wc_cap_inr=None if wc is None else int(wc),
    )


def latest_spot(grade_family: str) -> int:
    """Latest weekly market price for a grade_family = band anchor at week 0."""
    df = load_market_prices(grade_family=grade_family)
    if df.empty:
        raise ValueError(f"no market prices for grade_family {grade_family}")
    return int(df["price_inr_mt"].iloc[-1])


# --------------------------------------------------------------------------- #
# Series list + top-level assembler
# --------------------------------------------------------------------------- #
def list_series(run_id: str) -> list[tuple[str, str]]:
    """(material_code, plant_code) pairs that produced E10 demand rows this run
    — i.e. the solvable series (INSUFFICIENT_HISTORY already excluded)."""
    df = query_df(
        """
        SELECT DISTINCT m.code AS material_code, p.code AS plant_code
        FROM demand_forecasts df
        JOIN materials m ON m.id = df.material_id
        JOIN plants p ON p.id = df.plant_id
        WHERE df.run_id = %(run_id)s
        ORDER BY m.code, p.code
        """,
        {"run_id": run_id},
    )
    return [(r.material_code, r.plant_code) for r in df.itertuples()]


def assemble_series_inputs(
    run_id: str, material_code: str, plant_code: str, grade_family: str
) -> SeriesInputs:
    """Assemble the full solver input bundle for one material x plant series.

    Raises MissingDemandError / MissingPriceBandError when the series cannot be
    solved (caller maps these to run warnings — F3-ERR1 / F5-ERR2).
    """
    demand_p50 = load_demand_p50(run_id, material_code, plant_code)
    bands = load_price_bands(run_id, grade_family)  # raises F5-ERR2 if missing
    policy = load_policy()

    # On-hand + as_of from the latest snapshot for this series.
    inv = load_inventory_latest()
    inv_row = inv[
        (inv["material_code"] == material_code) & (inv["plant_code"] == plant_code)
    ]
    if inv_row.empty:
        on_hand_mt = 0.0
        as_of = date.today()
    else:
        on_hand_mt = float(inv_row["qty_mt"].iloc[0])
        as_of = inv_row["as_of_date"].iloc[0]

    cover = compute_cover(on_hand_mt, demand_p50)

    # Open POs for this series bucketed by delivery week.
    open_pos = load_open_pos(as_of)
    series_pos = open_pos[
        (open_pos["material_code"] == material_code)
        & (open_pos["plant_code"] == plant_code)
    ]
    open_po_by_week = bucket_open_pos_by_week(
        list(zip(series_pos["delivery_date"], series_pos["qty_mt"], strict=True)),
        as_of,
    )

    spot = latest_spot(grade_family)
    price_paths = build_price_paths(spot, bands)

    return SeriesInputs(
        material_code=material_code,
        plant_code=plant_code,
        grade_family=grade_family,
        as_of=as_of,
        on_hand_mt=on_hand_mt,
        demand_p50_mt=demand_p50,
        open_po_mt_by_week=open_po_by_week,
        cover_days=cover.cover_days,
        avg_daily_demand_mt=cover.avg_daily_demand_mt,
        spot_inr_mt=spot,
        price_paths=price_paths,
        band_4w=bands[4],
        offers=load_offers(material_code),
        share_denominator=share_denominator(material_code, plant_code, as_of),
        policy=policy,
    )
