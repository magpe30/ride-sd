import type { Corner } from "./corners";
import { bearingDegrees, cumulativeDistancesMeters, pointAtArcLength, type Position } from "./measure";
import type { Pass } from "../gpx/passes";

const MIN_TANGENT_SAMPLE_METERS = 10;
const MAX_TANGENT_SAMPLE_METERS = 25;

/** Returns the travel bearing through a corner so the camera can point it upward. */
export function cornerFocusBearing(
  line: readonly Position[],
  corner: Corner,
  direction: Pass["direction"]
): number {
  const cumulative = cumulativeDistancesMeters(line);
  const cornerLength = corner.endArcLengthMeters - corner.startArcLengthMeters;
  const tangentSampleMeters = Math.min(
    MAX_TANGENT_SAMPLE_METERS,
    Math.max(MIN_TANGENT_SAMPLE_METERS, cornerLength / 6)
  );
  const before = pointAtArcLength(
    line,
    cumulative,
    corner.apexArcLengthMeters - tangentSampleMeters
  );
  const after = pointAtArcLength(
    line,
    cumulative,
    corner.apexArcLengthMeters + tangentSampleMeters
  );
  const forwardBearing = bearingDegrees(before, after);

  return direction === "reverse" ? (forwardBearing + 180) % 360 : forwardBearing;
}
