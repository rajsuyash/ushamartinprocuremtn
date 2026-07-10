import { DECISION_NOTE_MIN_LENGTH, type DecisionActionInput } from "@pdi/shared";

// Pure helpers for the client decision bar — no React, no fetch, unit-testable
// in isolation (mirrors chips.ts / impact-bar.ts in this feature).

/** Mirrors the server-side NOTE_REQUIRED rule (route.ts): APPROVE never needs a
 * note; OVERRIDE/REJECT need >= DECISION_NOTE_MIN_LENGTH trimmed characters. */
export function isNoteValid(action: DecisionActionInput, note: string): boolean {
  if (action === "APPROVE") return true;
  return note.trim().length >= DECISION_NOTE_MIN_LENGTH;
}

// Greedy + end-anchored: the email itself may contain dots (e.g. "buyer@pdi.test"),
// so a non-greedy match would stop at the first one instead of the trailing sentence dot.
const DECIDED_BY_RE = /Already decided by (.+)\.$/;

/** Pulls the decider's email out of the ALREADY_DECIDED envelope message
 * (F6-ERR1: "Already decided by <email>.") for the stale-tab toast. */
export function extractDecidedByEmail(message: string): string | null {
  const match = DECIDED_BY_RE.exec(message);
  return match ? match[1] : null;
}
