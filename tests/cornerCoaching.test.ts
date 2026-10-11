import { describe, expect, it } from "vitest";

import { buildCornerCoachingInsights } from "@/lib/gpx/cornerCoaching";

import { makeMetrics } from "./fixtures";

describe("corner coaching insights", () => {
  it("describes a single ride without claiming improvement", () => {
    const insights = buildCornerCoachingInsights([makeMetrics()]);

    expect(insights.map((insight) => insight.label)).toEqual([
      "PREPARATION",
      "STABILITY",
      "CONSISTENCY",
    ]);
    expect(insights[2].value).toBe("NEEDS 2 RIDES");
  });

  it("compares stability and minimum-point consistency with the baseline", () => {
    const baseline = { ...makeMetrics(), minimumSpeedProgress: 0.5, speedRangeMps: 4 };
    const latest = { ...makeMetrics(), minimumSpeedProgress: 0.4, speedRangeMps: 3 };
    const insights = buildCornerCoachingInsights([baseline, latest]);

    expect(insights[1].value).toBe("STEADIER");
    expect(insights[2].detail).toMatch(/across 2 rides/i);
  });
});
