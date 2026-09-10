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

// A run can end up spanning hundreds of meters at a very shallow net
// angle when a long, nearly-straight stretch has enough digitization
// noise to intermittently cross the turn threshold, and the merge-gap
// bridging above stitches those noise blips into one "corner." A real
// corner — even a gentle sweeper — turns at a reasonably steady rate;
// checked against all four routes, there's a clean, order-of-magnitude
// gap in (angle / length) between these artifacts and genuine corners
// at around this value, with zero false positives on Sunrise Highway's
// tightly-clustered real corners (all 0.29-0.72 deg/m).
const MIN_SHARPNESS_DEG_PER_METER = 0.05;

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

  const candidates: Omit<Corner, "index">[] = [];
  let runStart = -1;

  // A run is grouped purely by turn *magnitude* crossing the threshold,
  // so a tight left hairpin immediately followed by a tight right
  // hairpin (an S-curve) lands in one run — and at the reversal point,
  // the turn rate passes through zero, naturally dipping under the
  // threshold for a step or two, which the merge-gap bridging above
  // then stitches back together as if it were one feature. Splitting
  // a closed run at every sign change turns that one run back into the
  // two real, separately-signed corners it actually contains — critical
  // because summing signed turn rates over an unsplit S-curve nets
  // toward zero, which would make two genuine hairpins look like one
  // long, shallow "corner" (and fail the sharpness check below).
  const closeRun = (runEndExclusive: number) => {
    if (runStart < 0) return;

    // Raw per-step sign, then debounced: a sign run shorter than
    // MIN_CORNER_STEPS is digitization noise flickering near zero, not
    // a real reversal, so it gets absorbed into the run before it
    // (mirrors the same debounce used for ride-direction reversals in
    // lib/gpx/passes.ts).
    const signs: number[] = [];
    for (let k = runStart; k < runEndExclusive; k += 1) {
      const sign = Math.sign(turnRates[k]);
      signs.push(sign !== 0 ? sign : (signs[signs.length - 1] ?? 1));
    }

    let debounced = true;
    while (debounced) {
      debounced = false;
      let i = 0;
      while (i < signs.length) {
        let j = i;
        while (j < signs.length && signs[j] === signs[i]) j += 1;
        if (i > 0 && j - i < MIN_CORNER_STEPS) {
          const previousSign = signs[i - 1];
          for (let k = i; k < j; k += 1) signs[k] = previousSign;
          debounced = true;
        }
        i = j;
      }
    }

    const segments: Array<[number, number]> = [];
    let segStart = 0;
    for (let i = 1; i < signs.length; i += 1) {
      if (signs[i] !== signs[segStart]) {
        segments.push([runStart + segStart, runStart + i]);
        segStart = i;
      }
    }
    segments.push([runStart + segStart, runEndExclusive]);

    for (const [segStartIndex, segEndExclusive] of segments) {
      if (segEndExclusive - segStartIndex < MIN_CORNER_STEPS) continue;

      const startPointIndex = pointIndexForTurnRate(segStartIndex);
      const endPointIndex = pointIndexForTurnRate(segEndExclusive - 1);

      let apexIndex = segStartIndex;
      for (let k = segStartIndex; k < segEndExclusive; k += 1) {
        if (Math.abs(turnRates[k]) > Math.abs(turnRates[apexIndex])) apexIndex = k;
      }

      const turnAngleDegrees = turnRates
        .slice(segStartIndex, segEndExclusive)
        .reduce((sum, rate) => sum + rate, 0);

      const startArcLengthMeters = points[startPointIndex].arcLengthMeters;
      const endArcLengthMeters = points[endPointIndex].arcLengthMeters;
      const lengthMeters = endArcLengthMeters - startArcLengthMeters;
      const sharpness = lengthMeters > 0 ? Math.abs(turnAngleDegrees) / lengthMeters : Infinity;

      if (sharpness < MIN_SHARPNESS_DEG_PER_METER) continue;

      candidates.push({
        startArcLengthMeters,
        endArcLengthMeters,
        apexArcLengthMeters: points[pointIndexForTurnRate(apexIndex)].arcLengthMeters,
        turnAngleDegrees: Math.abs(turnAngleDegrees),
        direction: turnAngleDegrees >= 0 ? "right" : "left",
      });
    }
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

  return candidates.map((corner, i) => ({ ...corner, index: i + 1 }));
}

export function countCorners(coordinates: readonly Position[]): number {
  return detectCorners(coordinates).length;
}
