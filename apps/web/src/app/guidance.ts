// Pure helpers for the dashboard "next best action" guidance card (post-login UX
// fix — CEO-reported "didn't know what to do next"). No db/React import —
// unit-testable without mocking, same pattern as ./tile-logic.ts.

export type GuidanceState = "NO_DATA" | "NO_RUN" | "REVIEW" | "ALERTS" | "TRACK";

export interface GuidanceInputs {
  hasCommittedData: boolean;
  hasDoneRun: boolean;
  pendingCount: number;
  openAlertCount: number;
}

/** Priority order: no data > no run > pending decisions > open alerts > tracking. */
export function deriveGuidanceState(inputs: GuidanceInputs): GuidanceState {
  const { hasCommittedData, hasDoneRun, pendingCount, openAlertCount } = inputs;
  if (!hasCommittedData) return "NO_DATA";
  if (!hasDoneRun) return "NO_RUN";
  if (pendingCount > 0) return "REVIEW";
  if (openAlertCount > 0) return "ALERTS";
  return "TRACK";
}

export type WorkflowStep = "UPLOAD" | "RUN" | "REVIEW" | "DECIDE" | "TRACK";

// The dashboard's five-chip workflow indicator, in display order.
export const WORKFLOW_STEPS: readonly WorkflowStep[] = [
  "UPLOAD",
  "RUN",
  "REVIEW",
  "DECIDE",
  "TRACK",
];

const STATE_TO_STEP: Record<GuidanceState, WorkflowStep> = {
  NO_DATA: "UPLOAD",
  NO_RUN: "RUN",
  REVIEW: "REVIEW",
  ALERTS: "DECIDE",
  TRACK: "TRACK",
};

/** Which of the five workflow chips is "current" for a given guidance state. */
export function mapStateToStep(state: GuidanceState): WorkflowStep {
  return STATE_TO_STEP[state];
}

// Shared cookie name for the dismissable welcome card (page.tsx reads it,
// actions.ts's "use server" module sets it — kept here since a "use server"
// file may only export async functions, not plain constants).
export const WELCOME_COOKIE_NAME = "pdi_welcome_dismissed";
