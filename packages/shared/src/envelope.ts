// API envelope (PRD §4): every web API response is
// { success, data, error: { code, message } | null }. Error codes are the
// SCREAMING_SNAKE names from the PRD feature tables — never free-form strings.

export type ErrorCode =
  | "UNAUTHENTICATED"
  | "FORBIDDEN_ROLE"
  | "NOT_FOUND"
  | "VALIDATION_ERROR"
  | "MISSING_COLUMN"
  | "FILE_TOO_LARGE"
  | "BLOCKING_ROW_ERRORS"
  // 409 on committing a batch that is already COMMITTED (F2 commit contract, T9).
  | "ALREADY_COMMITTED"
  | "ALREADY_DECIDED"
  | "NOTE_REQUIRED"
  // F6 decision input (T25): override.play missing on an OVERRIDE, and a decision
  // attempt on a recommendation that is neither PENDING nor already-decided
  // (EXPIRED / ERROR) — distinct from ALREADY_DECIDED so the UI can message each.
  | "OVERRIDE_PLAY_REQUIRED"
  | "DECISION_NOT_ALLOWED"
  | "ENGINE_UNAVAILABLE"
  // F10 simulation: no DONE run to baseline against / engine rejected the series.
  | "NO_COMPLETED_RUN"
  | "SIMULATION_FAILED"
  // ponytail: T11 — one recompute at a time; 409 when a run is already QUEUED/RUNNING.
  | "RUN_IN_PROGRESS"
  | "ALREADY_ACKED"
  | "INTERNAL"
  // Row-level ingest codes (F2): they never form a top-level envelope error —
  // they appear per bad row inside a staged batch's `errors[]`. Listed here so
  // the codes have one typed source of truth shared with the ingest layer.
  | "UNKNOWN_PLANT"
  | "UNKNOWN_MATERIAL"
  | "UNKNOWN_SUPPLIER"
  // ponytail: temporary code for T7 route stubs; drops out of use when T25
  // implements the decision handler.
  | "NOT_IMPLEMENTED";

export type Envelope<T> =
  | { success: true; data: T; error: null }
  | {
      success: false;
      data: null;
      // `detail` carries structured context for a few contracts (e.g. F2-ERR1
      // MISSING_COLUMN → `{ column }`); omitted entirely when absent, so callers
      // asserting `{ code, message }` exactly still match.
      error: { code: ErrorCode; message: string; detail?: Record<string, unknown> };
    };

export function ok<T>(data: T): Envelope<T> {
  return { success: true, data, error: null };
}

export function fail(
  code: ErrorCode,
  message: string,
  detail?: Record<string, unknown>,
): Envelope<never> {
  return {
    success: false,
    data: null,
    error: detail === undefined ? { code, message } : { code, message, detail },
  };
}
