import { describe, expect, it } from "vitest";

import type { Route } from "@/data/routes";
import { analyzeRide } from "@/lib/gpx/analyzeRide";
import type { TrackPoint } from "@/lib/gpx/parse";

function route(id: string, coordinates: [number, number][]): Route {
  return {
    id,
    name: id,
    markerLabel: id,
    markerCoordinate: coordinates[0],
    distanceMiles: 1,
    cornerCount: 0,
    description: id,
    line: { type: "LineString", coordinates },
    directionLabels: { forward: "FORWARD", reverse: "REVERSE" },
  };
}

function track(position: (index: number) => [number, number]): TrackPoint[] {
  return Array.from({ length: 40 }, (_, index) => {
    const [lon, lat] = position(index);
    return {
      lon,
      lat,
      elevationMeters: null,
      timeMs: index * 1000,
    };
  });
}

describe("route analysis errors", () => {
  const road = route("road", [[0, 0], [0.008, 0]]);

  it("returns no-route-match for an unrelated recording", () => {
    const result = analyzeRide(track((index) => [1 + index * 0.0001, 1]), [road]);
    expect(result).toEqual({ ok: false, reason: "no-route-match" });
  });

  it("does not guess when two routes match equally well", () => {
    const points = track((index) => [index * 0.0002, 0]);
    const result = analyzeRide(points, [road, route("duplicate", [[0, 0], [0.008, 0]])]);
    expect(result).toEqual({ ok: false, reason: "ambiguous-route" });
  });

  it("reports a route match with no usable traversal", () => {
    const result = analyzeRide(track(() => [0.004, 0]), [road]);
    expect(result).toEqual({ ok: false, reason: "no-usable-pass" });
  });

  it("accepts one confident continuous route match", () => {
    const result = analyzeRide(track((index) => [index * 0.0002, 0]), [road]);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.ride.route.id).toBe("road");
  });
});
