import { describe, expect, it } from "vitest";

import { dedupeDemandQuality } from "./quality";

describe("dedupeDemandQuality", () => {
  it("collapses a series' 12 weekly rows into one row per material x plant", () => {
    const rows = Array.from({ length: 12 }, (_, i) => ({
      materialCode: "WR-5.5-HC",
      plantCode: "RNC",
      model: "lightgbm",
      backtestWape: "0.135",
      week: `2026-07-${13 + i}`,
    }));

    const result = dedupeDemandQuality(rows);

    expect(result).toEqual([
      { materialCode: "WR-5.5-HC", plantCode: "RNC", model: "lightgbm", backtestWape: 0.135 },
    ]);
  });

  it("keeps distinct series separate", () => {
    const rows = [
      { materialCode: "WR-5.5-HC", plantCode: "RNC", model: "lightgbm", backtestWape: 0.135 },
      { materialCode: "WR-8-MS", plantCode: "HSP", model: "ets", backtestWape: 0.2 },
    ];

    expect(dedupeDemandQuality(rows)).toHaveLength(2);
  });

  it("returns an empty array for no rows", () => {
    expect(dedupeDemandQuality([])).toEqual([]);
  });
});
