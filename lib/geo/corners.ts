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
import {
  type Position,
  angleDiffDegrees,
  bearingDegrees,
  cumulativeDistancesMeters,
} from "./measure";

export type { Position };

const RESAMPLE_STEP_METERS = 15;
const HEADING_LOOKAHEAD_STEPS = 4;
const TURN_THRESHOLD_DEG_PER_STEP = 4;
const MIN_CORNER_STEPS = 2;
const MERGE_GAP_STEPS = 2;

// Resamples a line at a fixed arc-length step (meters) via linear
// interpolation, so corner detection doesn't depend on how densely the
// source data happened to be digitized.
function resampleLine(coordinates: readonly Position[], stepMeters: number): Position[] {
  if (coordinates.length < 2) return coordinates.slice();

  const cumulative = cumulativeDistancesMeters(coordinates);
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
