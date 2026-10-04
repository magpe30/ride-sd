import { describe, expect, it } from "vitest";

import {
  buildComparisonRides,
  displayTurnDirection,
  validateComparisonRoute,
} from "@/lib/gpx/comparison";

import { makePass, makeRide, testRoute } from "./fixtures";

describe("comparison selection", () => {
  it("orders passes by recorded time instead of upload order", () => {
    const newer = makeRide("newer", [makePass({ startTimeMs: 3000 })]);
    const oldest = makeRide("oldest", [makePass({ startTimeMs: 1000 })]);
    const latest = makeRide("latest", [makePass({ startTimeMs: 5000 })]);

    const selected = buildComparisonRides([newer, oldest, latest], "forward");

    expect(selected.map((ride) => ride.comparison.sourceRideId)).toEqual([
      "oldest",
      "newer",
      "latest",
    ]);
    expect(selected.map((ride) => ride.comparison.slot)).toEqual(["A", "B", "C"]);
  });

  it("can compare multiple passes from one recording", () => {
    const recording = makeRide("recording", [
      makePass({ startTimeMs: 1000 }),
      makePass({ startTimeMs: 3000 }),
    ]);

    const selected = buildComparisonRides([recording], "forward");

    expect(selected).toHaveLength(2);
    expect(selected.map((ride) => ride.label)).toEqual([
      "recording · Pass 1",
      "recording · Pass 2",
    ]);
  });

  it("keeps the oldest baseline and two newest passes when more than three exist", () => {
    const recording = makeRide(
      "recording",
      [1000, 2000, 3000, 4000].map((startTimeMs) => makePass({ startTimeMs }))
    );

    const selected = buildComparisonRides([recording], "forward");

    expect(selected.map((ride) => ride.comparison.startTimeMs)).toEqual([
      1000,
      3000,
      4000,
    ]);
  });

  it("promotes the next-oldest pass when the baseline is removed", () => {
    const oldest = makeRide("oldest", [makePass({ startTimeMs: 1000 })]);
    const later = makeRide("later", [makePass({ startTimeMs: 2000 })]);
    const latest = makeRide("latest", [makePass({ startTimeMs: 3000 })]);

    const selected = buildComparisonRides([later, latest], "forward");

    expect(selected[0].comparison.sourceRideId).toBe("later");
    expect(selected[0].comparison.slot).toBe("A");
    expect(buildComparisonRides([oldest, later, latest], "forward")[0].comparison.sourceRideId).toBe(
      "oldest"
    );
  });

  it("only includes passes traveling in the selected direction", () => {
    const recording = makeRide("recording", [
      makePass({ startTimeMs: 1000 }),
      makePass({ startTimeMs: 2000, direction: "reverse" }),
    ]);

    expect(buildComparisonRides([recording], "forward")).toHaveLength(1);
    expect(buildComparisonRides([recording], "reverse")).toHaveLength(1);
  });

  it("rejects a ride from another route without changing existing data", () => {
    const otherRoute = {
      ...testRoute,
      id: "other-route",
      name: "Other Route",
    };
    const existing = [makeRide("palomar", [makePass({ startTimeMs: 1000 })])];
    const candidate = makeRide(
      "other",
      [makePass({ startTimeMs: 2000 })],
      otherRoute
    ).ride;

    const result = validateComparisonRoute(candidate, existing);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toContain("Other Route");
      expect(result.message).toContain(testRoute.name);
    }
    expect(existing).toHaveLength(1);
  });

  it("flips turn direction for a reverse pass", () => {
    expect(displayTurnDirection("forward", "left")).toBe("left");
    expect(displayTurnDirection("reverse", "left")).toBe("right");
  });
});
