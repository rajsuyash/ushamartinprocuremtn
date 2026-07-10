import { describe, expect, it } from "vitest";

import { addWeeksToIsoDate } from "./horizon";

describe("addWeeksToIsoDate", () => {
  it("adds a 1-week horizon", () => {
    expect(addWeeksToIsoDate("2026-07-06", 1)).toBe("2026-07-13");
  });

  it("adds a 4-week horizon", () => {
    expect(addWeeksToIsoDate("2026-07-06", 4)).toBe("2026-08-03");
  });

  it("adds a 12-week horizon", () => {
    expect(addWeeksToIsoDate("2026-07-06", 12)).toBe("2026-09-28");
  });

  it("carries across a year boundary without a local-timezone shift", () => {
    expect(addWeeksToIsoDate("2026-12-25", 4)).toBe("2027-01-22");
  });
});
