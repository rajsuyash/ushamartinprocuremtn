import { describe, expect, it } from "vitest";
import { SHARED_PACKAGE_NAME } from "./index";

describe("shared package export", () => {
  it("exposes the package name constant", () => {
    expect(SHARED_PACKAGE_NAME).toBe("@pdi/shared");
  });
});
