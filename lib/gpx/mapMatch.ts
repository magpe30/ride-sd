// Projects a noisy GPS track onto a known-good reference road line,
// giving every kept point an arc-length ("distance along this road") and
// a lateral offset (how far it sat from the line — a data-quality/GPS-
// error signal). This is what makes "the same physical corner across
// different rides" comparable: every ride becomes a function of the same
// 1D arc-length domain instead of two noisy 2D traces we'd have to
// align against each other. Points too far from the road (commute miles,
// a stop at a lookout well off the pavement) are dropped entirely.
import { type Position, cumulativeDistancesMeters, toRadians } from "../geo/measure";
import type { TrackPoint } from "./parse";

export type MatchedSample = {
  timeMs: number;
  arcLengthMeters: number;
  lateralOffsetMeters: number;
  lon: number;
  lat: number;
};

const METERS_PER_DEGREE_LAT = 111320;
const DEFAULT_MAX_LATERAL_OFFSET_METERS = 50;

// Projects a point onto the nearest segment of a line using a local
// flat-earth (equirectangular) approximation — accurate enough for the
// short (tens of meters) segments in our reference roads.
function projectOntoLine(
  point: Position,
  line: readonly Position[],
  cumulative: readonly number[]
): { arcLengthMeters: number; lateralOffsetMeters: number } {
  let bestDistSq = Infinity;
  let bestArcLength = 0;

  for (let i = 0; i < line.length - 1; i += 1) {
    const a = line[i];
    const b = line[i + 1];
    const metersPerDegLon = METERS_PER_DEGREE_LAT * Math.cos(toRadians(a[1]));

    const bx = (b[0] - a[0]) * metersPerDegLon;
    const by = (b[1] - a[1]) * METERS_PER_DEGREE_LAT;
    const px = (point[0] - a[0]) * metersPerDegLon;
    const py = (point[1] - a[1]) * METERS_PER_DEGREE_LAT;

    const segLenSq = bx * bx + by * by;
    let t = segLenSq > 0 ? (px * bx + py * by) / segLenSq : 0;
    t = Math.max(0, Math.min(1, t));

    const dx = px - t * bx;
    const dy = py - t * by;
    const distSq = dx * dx + dy * dy;

    if (distSq < bestDistSq) {
      bestDistSq = distSq;
      const segLen = Math.sqrt(segLenSq);
      bestArcLength = cumulative[i] + t * segLen;
    }
  }

  return { arcLengthMeters: bestArcLength, lateralOffsetMeters: Math.sqrt(bestDistSq) };
}

// On a road with switchbacks, two physically distant strands of the
// route (a hairpin's inbound and outbound legs) can pass close enough
// together that a GPS point with ordinary error snaps onto the wrong
// one. That shows up as an arc-length "teleport" — an implausible jump
// versus the previous accepted sample — which would otherwise read as a
// speed spike. 40 m/s (~90 mph) is a generous upper bound for these
// roads, well above real riding speeds but well below what a mismatch
// jump produces.
const MAX_PLAUSIBLE_SPEED_MPS = 40;

function rejectArcLengthTeleports(samples: readonly MatchedSample[]): MatchedSample[] {
  const kept: MatchedSample[] = [];

  for (const sample of samples) {
    const previous = kept[kept.length - 1];
    if (previous) {
      const dtSeconds = (sample.timeMs - previous.timeMs) / 1000;
      const impliedSpeedMps =
        dtSeconds > 0
          ? Math.abs(sample.arcLengthMeters - previous.arcLengthMeters) / dtSeconds
          : 0;
      if (impliedSpeedMps > MAX_PLAUSIBLE_SPEED_MPS) continue;
    }
    kept.push(sample);
  }

  return kept;
}

export function matchTrackToLine(
  track: readonly TrackPoint[],
  referenceLine: readonly Position[],
  maxLateralOffsetMeters = DEFAULT_MAX_LATERAL_OFFSET_METERS
): MatchedSample[] {
  const cumulative = cumulativeDistancesMeters(referenceLine);
  const matched: MatchedSample[] = [];

  for (const point of track) {
    const { arcLengthMeters, lateralOffsetMeters } = projectOntoLine(
      [point.lon, point.lat],
      referenceLine,
      cumulative
    );

    if (lateralOffsetMeters <= maxLateralOffsetMeters) {
      matched.push({
        timeMs: point.timeMs,
        arcLengthMeters,
        lateralOffsetMeters,
        lon: point.lon,
        lat: point.lat,
      });
    }
  }

  return rejectArcLengthTeleports(matched);
}
