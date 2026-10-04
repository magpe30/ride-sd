import { describe, expect, it } from "vitest";

import type { MatchedSample } from "@/lib/gpx/mapMatch";
import { deriveSpeedProfile, removeStationaryBreaks } from "@/lib/gpx/speed";

function sample(timeMs: number, arcLengthMeters: number): MatchedSample {
  return {
    timeMs,
    arcLengthMeters,
    lateralOffsetMeters: 1,
    lon: -116,
    lat: 33,
  };
}

describe("stationary break removal", () => {
  it("removes a long stopped gap and rebases the remaining ride timeline", () => {
    const samples = [
      sample(0, 0),
      sample(1_000, 10),
      sample(2_000, 20),
      sample(3_000, 30),
      sample(303_000, 31),
      sample(304_000, 31),
      sample(305_000, 40),
      sample(306_000, 50),
    ];

    const cleaned = removeStationaryBreaks(samples);
    const profile = deriveSpeedProfile(cleaned);

    expect(cleaned.length).toBeLessThan(samples.length);
    expect(cleaned.at(-1)!.timeMs - cleaned[0].timeMs).toBeLessThan(10_000);
    expect(
      Math.max(...cleaned.slice(1).map((point, index) => point.timeMs - cleaned[index].timeMs))
    ).toBe(1_000);
    expect(profile.every((point) => point.speedMps > 0)).toBe(true);
  });

  it("keeps normal low-speed riding samples", () => {
    const samples = [sample(0, 0), sample(10_000, 5), sample(20_000, 10), sample(30_000, 15)];

    expect(removeStationaryBreaks(samples)).toEqual(samples);
  });

  it("keeps a long gap when the rider covered meaningful distance", () => {
    const samples = [sample(0, 0), sample(60_000, 500), sample(61_000, 510)];

    expect(removeStationaryBreaks(samples)).toEqual(samples);
  });
});
