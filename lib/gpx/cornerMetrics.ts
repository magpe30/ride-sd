// Computes per-corner metrics for one ride pass against a route's
// detected corners (lib/geo/corners.ts). Corners are defined once in
// absolute arc-length on the reference line; a pass's speed profile
// (lib/gpx/speed.ts) is just sampled at each corner's boundaries — this
// is the payoff of map-matching everything onto a shared arc-length
// domain instead of aligning two GPS traces against each other.
import type { Corner } from "../geo/corners";
import type { Pass } from "./passes";
import type { SpeedSample } from "./speed";

export type CornerMetrics = {
  corner: Corner;
  passDirection: Pass["direction"];
  cornerLengthMeters: number;
  approachSpeedMps: number;
  minSpeedMps: number;
  medianSpeedMps: number;
  maxSpeedMps: number;
  exitSpeedMps: number;
  speedLostMps: number;
  speedGainedMps: number;
  /**
   * Steady-state estimate from apex speed and the corner's local apex
   * radius — the same approximation track-telemetry tools use without
   * an IMU. It ignores road camber and rider countersteer dynamics, and
   * the underlying radius comes from the road centerline rather than
   * the actual ridden line (which typically apexes tighter), so this
   * estimate is expected to read a few degrees under a bike's own IMU
   * lean-angle sensor — treat it as a comparable estimate, not a
   * replacement for a real measurement.
   */
  estimatedLeanAngleDegrees: number;
};

const APPROACH_EXIT_OFFSET_METERS = 40;
const GRAVITY_MPS2 = 9.80665;

function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

// Linearly interpolates speed at a target arc-length. `sortedByArc` must
// be sorted ascending by arcLengthMeters.
function speedAtArcLength(
  sortedByArc: readonly SpeedSample[],
  targetArcLengthMeters: number
): number {
  const first = sortedByArc[0];
  const last = sortedByArc[sortedByArc.length - 1];

  if (targetArcLengthMeters <= first.arcLengthMeters) return first.speedMps;
  if (targetArcLengthMeters >= last.arcLengthMeters) return last.speedMps;

  for (let i = 1; i < sortedByArc.length; i += 1) {
    if (sortedByArc[i].arcLengthMeters >= targetArcLengthMeters) {
      const a = sortedByArc[i - 1];
      const b = sortedByArc[i];
      const span = b.arcLengthMeters - a.arcLengthMeters;
      const t = span > 0 ? (targetArcLengthMeters - a.arcLengthMeters) / span : 0;
      return a.speedMps + (b.speedMps - a.speedMps) * t;
    }
  }

  return last.speedMps;
}

export function computeCornerMetrics(
  corner: Corner,
  speedProfile: readonly SpeedSample[],
  passDirection: Pass["direction"],
  coverageToleranceMeters = 60
): CornerMetrics | null {
  if (speedProfile.length === 0) return null;

  const sortedByArc = [...speedProfile].sort((a, b) => a.arcLengthMeters - b.arcLengthMeters);
  const minCovered = sortedByArc[0].arcLengthMeters;
  const maxCovered = sortedByArc[sortedByArc.length - 1].arcLengthMeters;

  // Skip corners this pass didn't actually ride through (e.g. the ride
  // started or stopped mid-corner) rather than fabricate a value.
  if (
    corner.startArcLengthMeters < minCovered - coverageToleranceMeters ||
    corner.endArcLengthMeters > maxCovered + coverageToleranceMeters
  ) {
    return null;
  }

  const inCorner = sortedByArc.filter(
    (s) =>
      s.arcLengthMeters >= corner.startArcLengthMeters &&
      s.arcLengthMeters <= corner.endArcLengthMeters
  );
  if (inCorner.length === 0) return null;

  const speedsInCorner = inCorner.map((s) => s.speedMps);
  const minSpeedMps = Math.min(...speedsInCorner);
  const maxSpeedMps = Math.max(...speedsInCorner);
  const medianSpeedMps = median(speedsInCorner);

  // Which boundary is "entry" depends on which way this pass travels
  // the corner — a reverse pass meets the corner's end first.
  const entryArc =
    passDirection === "forward" ? corner.startArcLengthMeters : corner.endArcLengthMeters;
  const exitArc =
    passDirection === "forward" ? corner.endArcLengthMeters : corner.startArcLengthMeters;
  const inboundOffset =
    passDirection === "forward" ? -APPROACH_EXIT_OFFSET_METERS : APPROACH_EXIT_OFFSET_METERS;
  const outboundOffset =
    passDirection === "forward" ? APPROACH_EXIT_OFFSET_METERS : -APPROACH_EXIT_OFFSET_METERS;

  const approachSpeedMps = speedAtArcLength(sortedByArc, entryArc + inboundOffset);
  const exitSpeedMps = speedAtArcLength(sortedByArc, exitArc + outboundOffset);
  const apexSpeedMps = speedAtArcLength(sortedByArc, corner.apexArcLengthMeters);

  const cornerLengthMeters = corner.endArcLengthMeters - corner.startArcLengthMeters;

  // Prefer the apex's local radius (tightest point of the corner) over
  // the whole-corner average — a corner tapers in toward its apex, so
  // the average understates exactly how sharp the point the rider is
  // actually leaned over hardest really is. Only fall back to the
  // average when the local window came back degenerate (near-colinear
  // points, e.g. a very shallow sweeper).
  const turnAngleRadians = (corner.turnAngleDegrees * Math.PI) / 180;
  const averageRadiusMeters =
    turnAngleRadians > 0 ? cornerLengthMeters / turnAngleRadians : Infinity;
  const radiusMeters = Number.isFinite(corner.apexRadiusMeters)
    ? corner.apexRadiusMeters
    : averageRadiusMeters;

  const estimatedLeanAngleDegrees =
    Number.isFinite(radiusMeters) && radiusMeters > 0
      ? (Math.atan((apexSpeedMps * apexSpeedMps) / (GRAVITY_MPS2 * radiusMeters)) * 180) / Math.PI
      : 0;

  return {
    corner,
    passDirection,
    cornerLengthMeters,
    approachSpeedMps,
    minSpeedMps,
    medianSpeedMps,
    maxSpeedMps,
    exitSpeedMps,
    speedLostMps: approachSpeedMps - minSpeedMps,
    speedGainedMps: exitSpeedMps - minSpeedMps,
    estimatedLeanAngleDegrees,
  };
}

export function computeAllCornerMetrics(
  corners: readonly Corner[],
  speedProfile: readonly SpeedSample[],
  passDirection: Pass["direction"]
): CornerMetrics[] {
  const results: CornerMetrics[] = [];
  for (const corner of corners) {
    const metrics = computeCornerMetrics(corner, speedProfile, passDirection);
    if (metrics) results.push(metrics);
  }
  return results;
}
