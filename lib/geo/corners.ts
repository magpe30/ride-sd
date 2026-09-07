// Estimates a corner count for a road from its geometry alone, by
// resampling at a fixed distance and measuring heading change over a
// short lookahead window. This is a heuristic on clean OSM centerline
// data (no GPS noise to fight yet) — it's also the foundation the later
// GPX corner-detection phase will build on: same bearing/curvature math,
// applied there to rider traces map-matched onto these same lines.
//
// Parameters were tuned by comparing corner counts across all four ride
// routes and picking values that gave a consistent corners-per-mile
// figure despite their different characters (tight hairpins vs sweeping
// highway curves) — see scripts/data/fetch-osm-routes.mjs siblings for
// the source geometry these run on.
// Loose enough to accept GeoJSON's `Position` (number[]) directly.
export type Position = readonly number[];

const EARTH_RADIUS_METERS = 6371000;
const RESAMPLE_STEP_METERS = 15;
const HEADING_LOOKAHEAD_STEPS = 4;
const TURN_THRESHOLD_DEG_PER_STEP = 4;
const MIN_CORNER_STEPS = 2;
const MERGE_GAP_STEPS = 2;

function toRadians(deg: number): number {
  return (deg * Math.PI) / 180;
}

function toDegrees(rad: number): number {
  return (rad * 180) / Math.PI;
}

function haversineMeters([lon1, lat1]: Position, [lon2, lat2]: Position): number {
  const dLat = toRadians(lat2 - lat1);
  const dLon = toRadians(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRadians(lat1)) * Math.cos(toRadians(lat2)) * Math.sin(dLon / 2) ** 2;
  return EARTH_RADIUS_METERS * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function bearingDegrees([lon1, lat1]: Position, [lon2, lat2]: Position): number {
  const phi1 = toRadians(lat1);
  const phi2 = toRadians(lat2);
  const dLon = toRadians(lon2 - lon1);
  const y = Math.sin(dLon) * Math.cos(phi2);
  const x = Math.cos(phi1) * Math.sin(phi2) - Math.sin(phi1) * Math.cos(phi2) * Math.cos(dLon);
  return (toDegrees(Math.atan2(y, x)) + 360) % 360;
}

// Signed smallest angle from a to b, in (-180, 180].
function angleDiffDegrees(a: number, b: number): number {
  let diff = ((b - a + 180) % 360) - 180;
  if (diff < -180) diff += 360;
  return diff;
}

// Resamples a line at a fixed arc-length step (meters) via linear
// interpolation, so corner detection doesn't depend on how densely the
// source data happened to be digitized.
function resampleLine(coordinates: readonly Position[], stepMeters: number): Position[] {
  if (coordinates.length < 2) return coordinates.slice();

  const cumulative = [0];
  for (let i = 1; i < coordinates.length; i += 1) {
    cumulative.push(cumulative[i - 1] + haversineMeters(coordinates[i - 1], coordinates[i]));
  }

  const totalLength = cumulative[cumulative.length - 1];
  const resampled: Position[] = [];
  let segmentIndex = 0;

  for (let distance = 0; distance <= totalLength; distance += stepMeters) {
    while (
      segmentIndex < cumulative.length - 2 &&
      cumulative[segmentIndex + 1] < distance
    ) {
      segmentIndex += 1;
    }

    const segStart = cumulative[segmentIndex];
    const segEnd = cumulative[segmentIndex + 1];
    const t = segEnd > segStart ? (distance - segStart) / (segEnd - segStart) : 0;

    const a = coordinates[segmentIndex];
    const b = coordinates[segmentIndex + 1];
    resampled.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
  }

  return resampled;
}

export function countCorners(coordinates: readonly Position[]): number {
  const points = resampleLine(coordinates, RESAMPLE_STEP_METERS);
  if (points.length < HEADING_LOOKAHEAD_STEPS + 2) return 0;

  const headings: number[] = [];
  for (let i = 0; i < points.length - HEADING_LOOKAHEAD_STEPS; i += 1) {
    headings.push(bearingDegrees(points[i], points[i + HEADING_LOOKAHEAD_STEPS]));
  }

  const isTurning: boolean[] = [];
  for (let i = 1; i < headings.length; i += 1) {
    isTurning.push(Math.abs(angleDiffDegrees(headings[i - 1], headings[i])) >= TURN_THRESHOLD_DEG_PER_STEP);
  }

  // Bridge short straight gaps between turning stretches — a brief dip
  // mid-corner shouldn't split one corner into two.
  for (let i = 0; i < isTurning.length; i += 1) {
    if (isTurning[i]) continue;

    let gapEnd = i;
    while (gapEnd < isTurning.length && !isTurning[gapEnd]) gapEnd += 1;

    const hasTurnBefore = i > 0 && isTurning[i - 1];
    const hasTurnAfter = gapEnd < isTurning.length && isTurning[gapEnd];

    if (gapEnd - i <= MERGE_GAP_STEPS && hasTurnBefore && hasTurnAfter) {
      isTurning.fill(true, i, gapEnd);
    }

    i = gapEnd;
  }

  let cornerCount = 0;
  let runLength = 0;
  for (const turning of isTurning) {
    if (turning) {
      runLength += 1;
      continue;
    }
    if (runLength >= MIN_CORNER_STEPS) cornerCount += 1;
    runLength = 0;
  }
  if (runLength >= MIN_CORNER_STEPS) cornerCount += 1;

  return cornerCount;
}
