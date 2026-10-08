import { describe, expect, it } from "vitest";

import {
  comparisonCornerSummary,
  singleCornerSummary,
} from "@/lib/gpx/cornerSummary";

import { makeMetrics } from "./fixtures";

describe("corner performance summaries", () => {
  it("describes entry, minimum, and exit changes from baseline", () => {
    const baseline = makeMetrics(undefined, 10);
    const latest = makeMetrics(undefined, 12);

    expect(comparisonCornerSummary("C", latest, baseline)).toBe(
      "C was 4.5 mph faster on entry, 4.5 mph higher at minimum speed, and 4.5 mph faster on exit."
    );
  });

  it("reports missing coverage without inferring performance", () => {
    expect(comparisonCornerSummary("B", undefined, makeMetrics())).toBe(
      "B does not have enough coverage for a complete comparison with A."
    );
  });

  it("summarizes a single pass", () => {
    expect(singleCornerSummary(makeMetrics(undefined, 10))).toContain("Minimum 22.4 mph");
  });
});
