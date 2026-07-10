"""Live-DB integration tests for the T21 recommendation engine against the
seeded FIX-2/FIX-3 dataset (DATABASE_URL must point at the seeded engine DB).

- F5-AC1: WR-5.5-HC·RNC (cover below floor) -> BUY_NOW, >=1 order line, driver
  COVER_BELOW_FLOOR, deterministic across repeated runs.
- F5-AC3: WR-8-MS·HSP (comfortable, flat band) -> WAIT, zero order lines,
  driver COVER_COMFORTABLE.
- F5-AC2: the independent checker passes on every solved live series (cover
  floor + share cap respected by construction).
"""
import psycopg

from pdi_engine.config import get_settings
from pdi_engine.recommend import check_solution, recommend_series, solve_series
from pdi_engine.recommend.inputs import assemble_series_inputs


def _latest_run_id() -> str:
    with psycopg.connect(get_settings().database_url) as conn, conn.cursor() as cur:
        cur.execute("SELECT id FROM runs WHERE status = 'DONE' ORDER BY started_at DESC LIMIT 1")
        row = cur.fetchone()
    assert row is not None, "no DONE run seeded — run the pipeline first"
    return str(row[0])


# --- F5-AC1: deterministic BUY_NOW on the FIX-3 breach series ---------------- #
def test_fix3_breach_series_recommends_buy_now():
    si = assemble_series_inputs(_latest_run_id(), "WR-5.5-HC", "RNC", "WR-STD")
    rec = recommend_series(si)
    assert rec["play"] == "BUY_NOW"
    assert len(rec["orderLines"]) >= 1
    assert any(d["factor"] == "COVER_BELOW_FLOOR" for d in rec["rationale"]["drivers"])
    # order line shape (E13 camelCase contract)
    line = rec["orderLines"][0]
    assert set(line) == {"supplierCode", "qtyMt", "targetWeek", "estPriceInrMt"}
    assert line["qtyMt"] > 0 and line["estPriceInrMt"] > 0


def test_fix3_buy_now_is_deterministic():
    run_id = _latest_run_id()
    r1 = recommend_series(assemble_series_inputs(run_id, "WR-5.5-HC", "RNC", "WR-STD"))
    r2 = recommend_series(assemble_series_inputs(run_id, "WR-5.5-HC", "RNC", "WR-STD"))
    assert r1 == r2


# --- F5-AC3: deterministic WAIT on the comfortable series -------------------- #
def test_fix3_comfortable_series_recommends_wait():
    si = assemble_series_inputs(_latest_run_id(), "WR-8-MS", "HSP", "WR-STD")
    rec = recommend_series(si)
    assert rec["play"] == "WAIT"
    assert rec["orderLines"] == []
    assert any(d["factor"] == "COVER_COMFORTABLE" for d in rec["rationale"]["drivers"])
    assert rec["expectedImpact"]["wcDeltaInr"] == 0


# --- F5-AC2: independent checker on the live solved plans -------------------- #
def test_live_solved_plans_pass_independent_checker():
    run_id = _latest_run_id()
    for material, plant in (("WR-5.5-HC", "RNC"), ("WR-8-MS", "HSP")):
        si = assemble_series_inputs(run_id, material, plant, "WR-STD")
        art = solve_series(si)
        assert art.solved, f"{material}·{plant} did not solve: {art.status}"
        result = check_solution(si, art)
        assert result.ok, (
            f"{material}·{plant} checker failed: "
            f"cover={result.cover_violations} share={result.share_violations}"
        )


# --- rationale shape matches the PRD F5 example ----------------------------- #
def test_rationale_shape_matches_prd_contract():
    si = assemble_series_inputs(_latest_run_id(), "WR-5.5-HC", "RNC", "WR-STD")
    rationale = recommend_series(si)["rationale"]
    assert set(rationale["inputs"]) == {
        "coverDays", "minCoverDays", "band4w", "spotInrMt", "spread",
    }
    assert set(rationale["inputs"]["band4w"]) == {"p10", "p50", "p90"}
    assert rationale["constraintsRespected"][:2] == [
        "MIN_COVER_21D", "MAX_SUPPLIER_SHARE_60",
    ]
