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
  | "ALREADY_DECIDED"
  | "NOTE_REQUIRED"
  | "ENGINE_UNAVAILABLE"
  | "ALREADY_ACKED"
  | "INTERNAL"
  // ponytail: temporary code for T7 route stubs; drops out of use when T25
  // implements the decision handler.
  | "NOT_IMPLEMENTED";

export type Envelope<T> =
  | { success: true; data: T; error: null }
  | { success: false; data: null; error: { code: ErrorCode; message: string } };

export function ok<T>(data: T): Envelope<T> {
  return { success: true, data, error: null };
}

export function fail(code: ErrorCode, message: string): Envelope<never> {
  return { success: false, data: null, error: { code, message } };
}
