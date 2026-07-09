import { describe, expect, it } from "vitest";
import { SHARED_PACKAGE_NAME } from "@pdi/shared";

describe("apps/web smoke", () => {
  it("resolves the @pdi/shared workspace package", () => {
    expect(SHARED_PACKAGE_NAME).toBe("@pdi/shared");
  });
});
