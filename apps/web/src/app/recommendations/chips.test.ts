import { describe, expect, it } from "vitest";

import { playChipClass, playChipLabel, statusChipClass } from "./chips";

describe("playChipClass", () => {
  it("returns a distinct class per known play", () => {
    const classes = new Set(
      ["BUY_NOW", "WAIT", "PARTIAL_BUY", "HEDGE_LOCK", "SPLIT_SUPPLIERS"].map(playChipClass),
    );
    expect(classes.size).toBe(5);
  });

  it("falls back to a neutral class for a null play (ERROR rows)", () => {
    expect(playChipClass(null)).toBe("bg-surface-alt text-muted");
  });

  it("falls back to a neutral class for an unrecognized value", () => {
    expect(playChipClass("NOT_A_PLAY")).toBe("bg-surface-alt text-muted");
  });
});

describe("playChipLabel", () => {
  it("echoes the play", () => {
    expect(playChipLabel("BUY_NOW")).toBe("BUY_NOW");
  });

  it("labels a null play ERROR", () => {
    expect(playChipLabel(null)).toBe("ERROR");
  });
});

describe("statusChipClass", () => {
  it("returns a distinct class per known status", () => {
    const classes = new Set(
      ["PENDING", "APPROVED", "OVERRIDDEN", "REJECTED", "EXPIRED", "ERROR"].map(statusChipClass),
    );
    expect(classes.size).toBe(6);
  });

  it("falls back to a neutral class for an unrecognized value", () => {
    expect(statusChipClass("NOT_A_STATUS")).toBe("bg-surface-alt text-muted");
  });
});
