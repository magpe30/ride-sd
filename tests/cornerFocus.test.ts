import { describe, expect, it } from "vitest";

import type { Corner } from "@/lib/geo/corners";
import { cornerFocusBearing } from "@/lib/geo/cornerFocus";

const eastboundLine = [
  [-117, 33],
  [-116.999, 33],
  [-116.998, 33],
] as const;

const corner: Corner = {
  index: 1,
  startArcLengthMeters: 20,
  apexArcLengthMeters: 90,
  endArcLengthMeters: 160,
  turnAngleDegrees: 45,
  direction: "right",
  apexRadiusMeters: 50,
};

describe("corner focus bearing", () => {
  it("orients the route in the selected direction of travel", () => {
    const forward = cornerFocusBearing(eastboundLine, corner, "forward");
    const reverse = cornerFocusBearing(eastboundLine, corner, "reverse");

    expect(forward).toBeCloseTo(90, 0);
    expect(reverse).toBeCloseTo(270, 0);
  });
});
