import { describe, expect, it } from "vitest";

import { deriveGuidanceState, mapStateToStep } from "./guidance";

describe("deriveGuidanceState", () => {
  it("returns NO_DATA when nothing is committed yet", () => {
    expect(
      deriveGuidanceState({
        hasCommittedData: false,
        hasDoneRun: false,
        pendingCount: 0,
        openAlertCount: 0,
      }),
    ).toBe("NO_DATA");
  });

  it("returns NO_RUN once data is committed but no run has finished", () => {
    expect(
      deriveGuidanceState({
        hasCommittedData: true,
        hasDoneRun: false,
        pendingCount: 0,
        openAlertCount: 0,
      }),
    ).toBe("NO_RUN");
  });

  it("returns REVIEW when recommendations are pending, ahead of open alerts", () => {
    expect(
      deriveGuidanceState({
        hasCommittedData: true,
        hasDoneRun: true,
        pendingCount: 2,
        openAlertCount: 5,
      }),
    ).toBe("REVIEW");
  });

  it("returns ALERTS when nothing is pending but alerts are open", () => {
    expect(
      deriveGuidanceState({
        hasCommittedData: true,
        hasDoneRun: true,
        pendingCount: 0,
        openAlertCount: 1,
      }),
    ).toBe("ALERTS");
  });

  it("returns TRACK when everything is decided and there are no open alerts", () => {
    expect(
      deriveGuidanceState({
        hasCommittedData: true,
        hasDoneRun: true,
        pendingCount: 0,
        openAlertCount: 0,
      }),
    ).toBe("TRACK");
  });
});

describe("mapStateToStep", () => {
  it("maps each guidance state to its current workflow chip", () => {
    expect(mapStateToStep("NO_DATA")).toBe("UPLOAD");
    expect(mapStateToStep("NO_RUN")).toBe("RUN");
    expect(mapStateToStep("REVIEW")).toBe("REVIEW");
    expect(mapStateToStep("ALERTS")).toBe("DECIDE");
    expect(mapStateToStep("TRACK")).toBe("TRACK");
  });
});
