import { z } from "zod";

// F6 decision input contract (PRD §6 F6 "Data in"). Structural validation only —
// action/play must be valid enum members, idempotencyKey non-empty, override (when
// present) is `{ play }`. The CONDITIONAL rules (note ≥10 chars for OVERRIDE/REJECT;
// override.play required iff action=OVERRIDE) are enforced in the route so each maps
// to its own named envelope code (NOTE_REQUIRED / OVERRIDE_PLAY_REQUIRED) — a single
// zod refinement would collapse them into one VALIDATION_ERROR.

/** The five plays (PRD F5) — the only legal `override.play` values. */
export const PLAYS = [
  "BUY_NOW",
  "WAIT",
  "PARTIAL_BUY",
  "HEDGE_LOCK",
  "SPLIT_SUPPLIERS",
] as const;
export type Play = (typeof PLAYS)[number];

export const DECISION_ACTIONS = ["APPROVE", "OVERRIDE", "REJECT"] as const;
export type DecisionActionInput = (typeof DECISION_ACTIONS)[number];

/** Minimum note length for OVERRIDE / REJECT (PRD §6 F6: "≥10 chars"). */
export const DECISION_NOTE_MIN_LENGTH = 10;

export const decisionInputSchema = z.object({
  action: z.enum(DECISION_ACTIONS),
  // APPROVE allows an empty/absent note; the length rule for OVERRIDE/REJECT is a
  // separate route check so it can return NOTE_REQUIRED rather than VALIDATION_ERROR.
  // max lengths bound what lands in the append-only decision_records table
  note: z.string().max(2000).default(""),
  override: z.object({ play: z.enum(PLAYS) }).optional(),
  idempotencyKey: z.string().min(1).max(128),
});

export type DecisionInput = z.infer<typeof decisionInputSchema>;
