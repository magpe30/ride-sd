import { describe, expect, it } from "vitest";

import { advanceRidePlayback, initialRidePlaybackState } from "@/lib/gpx/playback";

import { makePass } from "./fixtures";

describe("recorded-time playback", () => {
  it("finishes at the recorded final sample", () => {
    const pass = makePass({ startTimeMs: 0 });
    const initial = initialRidePlaybackState("ride", pass, pass.speedProfile);
    const finished = advanceRidePlayback("ride", pass, pass.speedProfile, initial, 60);

    expect(finished.finished).toBe(true);
    expect(finished.timeMs).toBe(pass.speedProfile.at(-1)?.timeMs);
    expect(finished.arcLengthMeters).toBe(pass.speedProfile.at(-1)?.arcLengthMeters);
  });

  it("supports decreasing arc length in reverse direction", () => {
    const pass = makePass({ startTimeMs: 0, direction: "reverse" });
    const initial = initialRidePlaybackState("ride", pass, pass.speedProfile);
    const halfway = advanceRidePlayback("ride", pass, pass.speedProfile, initial, 2);

    expect(halfway.arcLengthMeters).toBe(200);
    expect(halfway.finished).toBe(false);
  });
});
