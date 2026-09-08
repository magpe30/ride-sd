// Detects individual corners on a road from its geometry alone, by
// resampling at a fixed distance and measuring heading change over a
// short lookahead window. This runs once against clean OSM centerline
// data (no GPS noise to fight yet) and gives each corner an arc-length
// range — the same arc-length domain the GPX pipeline (lib/gpx/*)
// map-matches rides onto, so a corner detected here is directly
// addressable by any ride that passed through it.
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

export type Corner = {
  /** 1-based order along the route, in the direction the coordinates run. */
  index: number;
  startArcLengthMeters: number;
  endArcLengthMeters: number;
  /** Arc-length of the point with the sharpest instantaneous turn rate. */
  apexArcLengthMeters: number;
  /** Net heading change through the corner — a proxy for how tight/long a turn it is. */
  turnAngleDegrees: number;
  direction: "left" | "right";
};

const RESAMPLE_STEP_METERS = 15;
const HEADING_LOOKAHEAD_STEPS = 4;
const TURN_THRESHOLD_DEG_PER_STEP = 4;
const MIN_CORNER_STEPS = 2;
const MERGE_GAP_STEPS = 2;

type ResampledPoint = {
  position: Position;
  arcLengthMeters: number;
};

// Resamples a line at a fixed arc-length step (meters) via linear
// interpolation, so corner detection doesn't depend on how densely the
// source data happened to be digitized.
function resampleLine(coordinates: readonly Position[], stepMeters: number): ResampledPoint[] {
  if (coordinates.length < 2) {
    return coordinates.map((position) => ({ position, arcLengthMeters: 0 }));
  }

  const cumulative = cumulativeDistancesMeters(coordinates);
  const totalLength = cumulative[cumulative.length - 1];
  const resampled: ResampledPoint[] = [];
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
    resampled.push({
      position: [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t],
      arcLengthMeters: distance,
    });
  }

  return resampled;
}

export function detectCorners(coordinates: readonly Position[]): Corner[] {
  const points = resampleLine(coordinates, RESAMPLE_STEP_METERS);
  if (points.length < HEADING_LOOKAHEAD_STEPS + 2) return [];

  const headings: number[] = [];
  for (let i = 0; i < points.length - HEADING_LOOKAHEAD_STEPS; i += 1) {
    headings.push(bearingDegrees(points[i].position, points[i + HEADING_LOOKAHEAD_STEPS].position));
  }

  // Signed turn rate per step — sign gives turn direction, magnitude
  // feeds both the threshold test and apex-finding.
  const turnRates: number[] = [];
  for (let i = 1; i < headings.length; i += 1) {
    turnRates.push(angleDiffDegrees(headings[i - 1], headings[i]));
  }

  const isTurning = turnRates.map((rate) => Math.abs(rate) >= TURN_THRESHOLD_DEG_PER_STEP);

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

  // turnRates[k] = angleDiff(headings[k], headings[k+1]), and headings[i]
  // is anchored at points[i] — so turnRates[k] describes the turn
  // located at points[k + 1].
  const pointIndexForTurnRate = (k: number) => k + 1;

  const corners: Corner[] = [];
  let runStart = -1;

  const closeRun = (runEndExclusive: number) => {
    if (runStart < 0) return;

    const startPointIndex = pointIndexForTurnRate(runStart);
    const endPointIndex = pointIndexForTurnRate(runEndExclusive - 1);

    let apexIndex = runStart;
    for (let k = runStart; k < runEndExclusive; k += 1) {
      if (Math.abs(turnRates[k]) > Math.abs(turnRates[apexIndex])) apexIndex = k;
    }

    const turnAngleDegrees = turnRates
      .slice(runStart, runEndExclusive)
      .reduce((sum, rate) => sum + rate, 0);

    corners.push({
      index: corners.length + 1,
      startArcLengthMeters: points[startPointIndex].arcLengthMeters,
      endArcLengthMeters: points[endPointIndex].arcLengthMeters,
      apexArcLengthMeters: points[pointIndexForTurnRate(apexIndex)].arcLengthMeters,
      turnAngleDegrees: Math.abs(turnAngleDegrees),
      direction: turnAngleDegrees >= 0 ? "right" : "left",
    });
  };

  for (let i = 0; i < isTurning.length; i += 1) {
    if (isTurning[i]) {
      if (runStart < 0) runStart = i;
      continue;
    }
    if (runStart >= 0 && i - runStart >= MIN_CORNER_STEPS) closeRun(i);
    runStart = -1;
  }
  if (runStart >= 0 && isTurning.length - runStart >= MIN_CORNER_STEPS) {
    closeRun(isTurning.length);
  }

  return corners;
}

export function countCorners(coordinates: readonly Position[]): number {
  return detectCorners(coordinates).length;
}
