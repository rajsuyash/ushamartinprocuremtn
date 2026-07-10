import { describe, expect, it } from "vitest";

import { bestSupplierOffer, classifyBandDirection, isCoverBreach } from "./tile-logic";

describe("classifyBandDirection", () => {
  it("classifies rising when P50 is more than 1% above spot", () => {
    expect(classifyBandDirection(54576, 55016)).toBe("flat"); // ~-0.8%, inside eps
    expect(classifyBandDirection(56000, 55016)).toBe("rising"); // ~+1.8%
  });

  it("classifies falling when P50 is more than 1% below spot", () => {
    expect(classifyBandDirection(53000, 55016)).toBe("falling"); // ~-3.7%
  });

  it("classifies flat at the exact boundary", () => {
    expect(classifyBandDirection(55016, 55016)).toBe("flat");
  });

  it("treats a non-positive spot defensively as flat rather than dividing by zero", () => {
    expect(classifyBandDirection(100, 0)).toBe("flat");
  });
});

describe("bestSupplierOffer", () => {
  it("returns the lowest-priced supplier from the spread map", () => {
    expect(
      bestSupplierOffer({ JSW: 54355, TATA_LP: 54011, IMPORT_GEN: 56340 }),
    ).toEqual({ supplierCode: "TATA_LP", priceInrMt: 54011 });
  });

  it("returns null for an empty spread map", () => {
    expect(bestSupplierOffer({})).toBeNull();
  });

  it("returns the single entry when there is only one supplier", () => {
    expect(bestSupplierOffer({ JSW: 54355 })).toEqual({
      supplierCode: "JSW",
      priceInrMt: 54355,
    });
  });
});

describe("isCoverBreach", () => {
  it("is true when cover days is below the policy floor", () => {
    expect(isCoverBreach(16.6, 21)).toBe(true);
  });

  it("is false when cover days meets or exceeds the floor", () => {
    expect(isCoverBreach(21, 21)).toBe(false);
    expect(isCoverBreach(28.9, 21)).toBe(false);
  });
});
