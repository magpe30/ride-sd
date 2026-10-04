import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { routes } from "@/data/routes";
import { analyzeRide } from "@/lib/gpx/analyzeRide";
import { parseGpx } from "@/lib/gpx/parse";

const palomarRecordings = [
  "Connected_20260118_090837_Jan_18_2026_at_9_08_AM.gpx",
  "Connected_20260125_091123_Jan_25_2026_at_9_11_AM.gpx",
];

describe("Palomar stationary breaks", () => {
  it.each(palomarRecordings)("excludes stopped time from %s", (file) => {
    const result = analyzeRide(parseGpx(readFileSync(file, "utf8")), routes);

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    for (const pass of result.ride.passes) {
      const gaps = pass.samples
        .slice(1)
        .map((sample, index) => sample.timeMs - pass.samples[index].timeMs);

      expect(Math.max(...gaps)).toBeLessThan(30_000);
    }
  });
});
