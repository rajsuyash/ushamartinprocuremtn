import { describe, expect, it } from "vitest";

import { extractDecidedByEmail, isNoteValid } from "./decision-logic";

// F6-AC2/F6-ERR2 pure logic: note-length gate (mirrors DECISION_NOTE_MIN_LENGTH
// server rule) + F6-ERR1 "Already decided by <email>" message parsing.

describe("isNoteValid", () => {
  it("APPROVE never requires a note", () => {
    expect(isNoteValid("APPROVE", "")).toBe(true);
    expect(isNoteValid("APPROVE", "short")).toBe(true);
  });

  it("OVERRIDE requires at least 10 trimmed characters", () => {
    expect(isNoteValid("OVERRIDE", "short")).toBe(false);
    expect(isNoteValid("OVERRIDE", "  short   ")).toBe(false);
    expect(isNoteValid("OVERRIDE", "this is long enough")).toBe(true);
  });

  it("REJECT requires at least 10 trimmed characters", () => {
    expect(isNoteValid("REJECT", "9 chars!!")).toBe(false);
    expect(isNoteValid("REJECT", "exactly 10")).toBe(true);
  });

  it("does not count leading/trailing whitespace toward the minimum", () => {
    expect(isNoteValid("OVERRIDE", "         ")).toBe(false);
  });
});

describe("extractDecidedByEmail", () => {
  it("parses the decider email out of the ALREADY_DECIDED message", () => {
    expect(extractDecidedByEmail("Already decided by buyer@pdi.test.")).toBe(
      "buyer@pdi.test",
    );
  });

  it("returns null when the message doesn't match the expected shape", () => {
    expect(extractDecidedByEmail("Something else entirely")).toBeNull();
  });
});
