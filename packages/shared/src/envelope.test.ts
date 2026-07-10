import { describe, expect, it } from "vitest";

import { fail, ok } from "./envelope";

describe("envelope constructors (PRD §4)", () => {
  it("ok() wraps data with error: null", () => {
    expect(ok({ recommendations: [] })).toEqual({
      success: true,
      data: { recommendations: [] },
      error: null,
    });
  });

  it("fail() carries the code/message pair with data: null", () => {
    expect(fail("UNAUTHENTICATED", "Authentication required.")).toEqual({
      success: false,
      data: null,
      error: { code: "UNAUTHENTICATED", message: "Authentication required." },
    });
  });
});
