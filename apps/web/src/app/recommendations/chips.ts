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
  BUY_NOW: "bg-green-100 text-green-800",
  WAIT: "bg-gray-100 text-gray-700",
  PARTIAL_BUY: "bg-blue-100 text-blue-800",
  HEDGE_LOCK: "bg-purple-100 text-purple-800",
  SPLIT_SUPPLIERS: "bg-indigo-100 text-indigo-800",
};

/** Tailwind classes for the play chip. `play` is null for ERROR rows (PRD
 * F5-ERR1/ERR3 — `play IS NULL` iff `status = 'ERROR'`, enforced by a DB CHECK)
 * — falls back to a neutral chip rather than throwing on the null. */
export function playChipClass(play: string | null): string {
  if (play && isPlay(play)) return PLAY_CHIP_CLASS[play];
  return "bg-gray-100 text-gray-500";
}

/** Chip label: the play itself, or "ERROR" for the null-play degraded row. */
export function playChipLabel(play: string | null): string {
  return play ?? "ERROR";
}

const STATUS_CHIP_CLASS: Record<RecommendationStatus, string> = {
  PENDING: "bg-amber-100 text-amber-800",
  APPROVED: "bg-green-100 text-green-800",
  OVERRIDDEN: "bg-blue-100 text-blue-800",
  REJECTED: "bg-red-100 text-red-800",
  EXPIRED: "bg-gray-100 text-gray-500",
  ERROR: "bg-red-200 text-red-900",
};

function isRecommendationStatus(value: string): value is RecommendationStatus {
  return (recommendationStatus.enumValues as readonly string[]).includes(value);
}

/** Tailwind classes for the status chip (`[data-testid="status-chip"]` on the
 * detail page). Falls back to a neutral chip for any unrecognized value rather
 * than throwing — defensive against future enum drift. */
export function statusChipClass(status: string): string {
  return isRecommendationStatus(status) ? STATUS_CHIP_CLASS[status] : "bg-gray-100 text-gray-700";
}
