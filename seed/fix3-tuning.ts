// FIX-3 tuning constants (PRD §10). These are the knobs that make the demo tell a
// clean story: one deterministic BUY_NOW and one deterministic WAIT. They are
// exported so M2–M4 can re-tune if the engine's *computed* plays don't match the
// FIX-3 expectations (e.g. the cover formula weights open POs differently than the
// seed does) — change the number here, reseed, rather than hand-editing rows.
//
// How the seed uses them: for each material×plant we set the current inventory
// snapshot to `coverDays × trailing-8-week average daily consumption`, computed
// analytically from the generated consumption series (never a hand-picked tonnage).
// So "cover" here means inventory ÷ forecast daily demand — the honest metric.

/**
 * WR-5.5-HC · RNC — the breach series. Projected cover ≈ 18.2 days, below the 21-day
 * `min_cover_days` floor. Paired with a WR-STD price band that is rising into the
 * present (see WR_STD_END_MOMENTUM_PCT) → the engine should emit BUY_NOW.
 */
export const COVER_BREACH_DAYS = 18.2;

/**
 * WR-8-MS · HSP — the WAIT series. Comfortable ≈ 40-day cover.
 *
 * NUANCE (documented per task): WR-8-MS shares grade_family WR-STD with the breach
 * material, so it is priced off the SAME rising WR-STD index — we cannot give it a
 * separate "flat" price series to justify WAIT. The WAIT play here therefore comes
 * purely from comfortable cover: there is no cover pressure forcing a buy, so even a
 * mildly rising price does not warrant acting now. If M2's engine leans on price
 * momentum hard enough to still flag WR-8-MS, raise this number (more cover = more
 * reason to wait) rather than inventing a second price series.
 */
export const COMFORTABLE_COVER_DAYS = 40;

/** Every other material×plant — healthy, unremarkable middle-of-band cover. */
export const NEUTRAL_COVER_DAYS = 28;

/** Trailing window (weeks) used to derive average daily consumption for cover. */
export const TRAILING_WEEKS_FOR_COVER = 8;

/**
 * The WR-STD index ends with clear upward momentum: the final 6 weekly points ramp
 * up ~+2% relative to the week before the window, monotonically. This is what makes
 * the breach a BUY_NOW (buy before it climbs further) rather than a HEDGE/WAIT.
 */
export const WR_STD_END_MOMENTUM_PCT = 0.02;
export const WR_STD_MOMENTUM_WEEKS = 6;
