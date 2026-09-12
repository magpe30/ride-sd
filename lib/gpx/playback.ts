// Advances a ride's position along the shared arc-length domain in real
// (but compressed) time, using its own recorded speed at each point —
// so a replay genuinely slows into hairpins and picks up on sweepers
// the way the actual ride did, rather than sweeping the road at a
// constant pace. With more than one ride loaded, each one advances
// independently from this same starting instant, so faster/slower
// stretches visibly separate them — the "ghost race" effect.
import type { Pass } from "./passes";
import { speedAtArcLengthMeters, type SpeedSample } from "./speed";

export type RidePlaybackState = {
  rideId: string;
  arcLengthMeters: number;
  /**
   * The actual recorded speed at this position — *not* clamped to
   * MIN_PLAYBACK_SPEED_MPS below, so a UI readout of this value truly
   * reflects the ride (e.g. reading near 0 during a real stop, even
   * though the marker keeps crawling forward at the floor pace).
   */
  speedMps: number;
  finished: boolean;
};

// A real ride's recorded speed drops to ~0 at stops (traffic, photos,
// fuel) — advancing playback at the literal recorded speed would leave
// the marker visibly stalled on-screen for as long as the stop lasted.
// Playback always advances at least this fast so the replay keeps
// moving; it only ever pushes the pace *up*, never slows down a
// genuinely fast stretch.
const MIN_PLAYBACK_SPEED_MPS = 4.5; // ~10 mph

// A pass's samples are in chronological order, so the first/last sample
// is where this ride's playback starts/ends — for a reverse pass that
// means starting at a *higher* arc-length and decreasing over time.
function passEndpoints(pass: Pass): { startArcLengthMeters: number; endArcLengthMeters: number } {
  return {
    startArcLengthMeters: pass.samples[0].arcLengthMeters,
    endArcLengthMeters: pass.samples[pass.samples.length - 1].arcLengthMeters,
  };
}

export function initialRidePlaybackState(
  rideId: string,
  pass: Pass,
  sortedSpeedProfile: readonly SpeedSample[]
): RidePlaybackState {
  const { startArcLengthMeters } = passEndpoints(pass);
  return {
    rideId,
    arcLengthMeters: startArcLengthMeters,
    speedMps:
      sortedSpeedProfile.length > 0
        ? speedAtArcLengthMeters(sortedSpeedProfile, startArcLengthMeters)
        : 0,
    finished: pass.samples.length < 2,
  };
}

export function advanceRidePlayback(
  rideId: string,
  pass: Pass,
  sortedSpeedProfile: readonly SpeedSample[],
  current: RidePlaybackState,
  dtSeconds: number
): RidePlaybackState {
  if (current.finished || sortedSpeedProfile.length === 0 || dtSeconds <= 0) return current;

  const { endArcLengthMeters } = passEndpoints(pass);
  const directionSign = pass.direction === "forward" ? 1 : -1;

  const actualSpeedMps = speedAtArcLengthMeters(sortedSpeedProfile, current.arcLengthMeters);
  const movementSpeedMps = Math.max(actualSpeedMps, MIN_PLAYBACK_SPEED_MPS);

  const nextArcLengthMeters = current.arcLengthMeters + directionSign * movementSpeedMps * dtSeconds;
  const reachedEnd =
    directionSign > 0
      ? nextArcLengthMeters >= endArcLengthMeters
      : nextArcLengthMeters <= endArcLengthMeters;

  return reachedEnd
    ? { rideId, arcLengthMeters: endArcLengthMeters, speedMps: actualSpeedMps, finished: true }
    : { rideId, arcLengthMeters: nextArcLengthMeters, speedMps: actualSpeedMps, finished: false };
}
