"""F5 play recommendation — input assembly (T20) + solver/classifier (T21)."""
from .checker import CheckResult, check_solution
from .classifier import Classification, classify
from .montecarlo import compute_impact
from .rationale import build_rationale
from .recommend import recommend_series
from .solver import SolveArtifacts, solve_series
from .inputs import (
    CoverState,
    MissingDemandError,
    MissingPriceBandError,
    PolicyInputs,
    PriceBand,
    PricePaths,
    SeriesInputs,
    ShareDenominator,
    SupplierOffer,
    assemble_series_inputs,
    bucket_open_pos_by_week,
    build_price_paths,
    compute_cover,
    forward_avg_daily_demand,
    interpolate_path,
    list_series,
    load_demand_p50,
    load_offers,
    load_policy,
    load_price_bands,
    share_denominator,
)

__all__ = [
    "CheckResult",
    "check_solution",
    "Classification",
    "classify",
    "compute_impact",
    "build_rationale",
    "recommend_series",
    "SolveArtifacts",
    "solve_series",
    "CoverState",
    "MissingDemandError",
    "MissingPriceBandError",
    "PolicyInputs",
    "PriceBand",
    "PricePaths",
    "SeriesInputs",
    "ShareDenominator",
    "SupplierOffer",
    "assemble_series_inputs",
    "bucket_open_pos_by_week",
    "build_price_paths",
    "compute_cover",
    "forward_avg_daily_demand",
    "interpolate_path",
    "list_series",
    "load_demand_p50",
    "load_offers",
    "load_policy",
    "load_price_bands",
    "share_denominator",
]
