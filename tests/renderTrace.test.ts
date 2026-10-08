import { describe, expect, it } from "vitest";

import { traceCoordinatesBehind } from "@/lib/gpx/renderTrace";

const trace = {
  coordinates: [
    [0, 0],
    [1, 0],
    [2, 0],
    [3, 0],
    [4, 0],
  ] as [number, number][],
  arcLengthsMeters: [0, 100, 200, 300, 400],
};

describe("playback trail", () => {
  it("returns only the recent forward trace", () => {
    expect(traceCoordinatesBehind(trace, 300, "forward", 150)).toEqual([
      [1.5, 0],
      [2, 0],
      [3, 0],
    ]);
  });

  it("returns the recent reverse trace in travel order", () => {
    const reverseTrace = {
      coordinates: [...trace.coordinates].reverse(),
      arcLengthsMeters: [...trace.arcLengthsMeters].reverse(),
    };
    expect(traceCoordinatesBehind(reverseTrace, 100, "reverse", 150)).toEqual([
      [2.5, 0],
      [2, 0],
      [1, 0],
    ]);
  });
});
