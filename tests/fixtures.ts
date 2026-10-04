import { detectCorners, type Corner } from "@/lib/geo/corners";
import type { AnalyzedPass } from "@/lib/gpx/analyzeRide";
import type { CornerMetrics } from "@/lib/gpx/cornerMetrics";
import type { Pass } from "@/lib/gpx/passes";
import type { LoadedRide } from "@/lib/gpx/session";
import { routes } from "@/data/routes";

export const testRoute = routes[0];
export const testCorner = detectCorners(testRoute.line.coordinates)[0];

export function makeMetrics(
  corner: Corner = testCorner,
  minSpeedMps = 10,
  direction: Pass["direction"] = "forward"
): CornerMetrics {
  return {
    corner,
    passDirection: direction,
    cornerLengthMeters: corner.endArcLengthMeters - corner.startArcLengthMeters,
    approachSpeedMps: minSpeedMps + 3,
    minSpeedMps,
    medianSpeedMps: minSpeedMps + 1,
    maxSpeedMps: minSpeedMps + 4,
    exitSpeedMps: minSpeedMps + 2,
    speedLostMps: 3,
    speedGainedMps: 2,
    estimatedLeanAngleDegrees: 24,
  };
}

export function makePass({
  startTimeMs,
  direction = "forward",
  minSpeedMps = 10,
  withMetrics = true,
}: {
  startTimeMs: number;
  direction?: Pass["direction"];
  minSpeedMps?: number;
  withMetrics?: boolean;
}): AnalyzedPass {
  const ascending = [0, 100, 200, 300, 400];
  const arcs = direction === "forward" ? ascending : [...ascending].reverse();
  const samples = arcs.map((arcLengthMeters, index) => ({
    timeMs: startTimeMs + index * 1000,
    arcLengthMeters,
    lateralOffsetMeters: 2,
    lon: testRoute.line.coordinates[index][0],
    lat: testRoute.line.coordinates[index][1],
  }));

  return {
    direction,
    samples,
    speedProfile: samples.map((sample) => ({ ...sample, speedMps: minSpeedMps })),
    cornerMetrics: withMetrics
      ? [makeMetrics(testCorner, minSpeedMps, direction)]
      : [],
  };
}

export function makeRide(
  id: string,
  passes: AnalyzedPass[],
  route = testRoute
): LoadedRide {
  return {
    id,
    label: id,
    color: "#2fe0ff",
    ride: { route, passes },
  };
}
