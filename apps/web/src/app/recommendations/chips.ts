import { PLAYS, type Play } from "@pdi/shared";

import { recommendationStatus } from "@/db/schema";

// Pure play/status -> Tailwind chip class + label mapping (list + detail pages).
// No db connection, no React import — unit-testable in isolation (task card
// point 3). `PLAYS`/`recommendationStatus.enumValues` are the same canonical
// enums the schema and the F6 decision-input contract use — reused here rather
// than re-hardcoded (known pitfall: casing/enum drift between layers).

type RecommendationStatus = (typeof recommendationStatus.enumValues)[number];

function isPlay(value: string): value is Play {
  return (PLAYS as readonly string[]).includes(value);
}

const PLAY_CHIP_CLASS: Record<Play, string> = {
  BUY_NOW: "bg-positive-surface text-positive",
  WAIT: "bg-surface-alt text-muted",
  PARTIAL_BUY: "bg-secondary-surface text-secondary",
  HEDGE_LOCK: "bg-warn-surface text-warn",
  SPLIT_SUPPLIERS: "bg-primary-surface text-primary",
};

/** Tailwind classes for the play chip. `play` is null for ERROR rows (PRD
 * F5-ERR1/ERR3 — `play IS NULL` iff `status = 'ERROR'`, enforced by a DB CHECK)
 * — falls back to a neutral chip rather than throwing on the null. */
export function playChipClass(play: string | null): string {
  if (play && isPlay(play)) return PLAY_CHIP_CLASS[play];
  return "bg-surface-alt text-muted";
}

/** Chip label: the play itself, or "ERROR" for the null-play degraded row. */
export function playChipLabel(play: string | null): string {
  return play ?? "ERROR";
}

const STATUS_CHIP_CLASS: Record<RecommendationStatus, string> = {
  PENDING: "bg-warn-surface text-warn",
  APPROVED: "bg-positive-surface text-positive",
  OVERRIDDEN: "bg-secondary-surface text-secondary",
  REJECTED: "bg-risk-surface text-risk",
  EXPIRED: "bg-surface-alt text-muted",
  ERROR: "bg-risk text-white",
};

function isRecommendationStatus(value: string): value is RecommendationStatus {
  return (recommendationStatus.enumValues as readonly string[]).includes(value);
}

/** Tailwind classes for the status chip (`[data-testid="status-chip"]` on the
 * detail page). Falls back to a neutral chip for any unrecognized value rather
 * than throwing — defensive against future enum drift. */
export function statusChipClass(status: string): string {
  return isRecommendationStatus(status) ? STATUS_CHIP_CLASS[status] : "bg-surface-alt text-muted";
}
