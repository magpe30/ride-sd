// Replays a pass along its analyzed timestamp timeline. Stationary breaks are
// removed during analysis; real riding pace remains, and reverse passes
// naturally move toward lower arc lengths.
import type { Pass } from "./passes";
import type { SpeedSample } from "./speed";

export type RidePlaybackState = {
  rideId: string;
  arcLengthMeters: number;
  timeMs: number;
  speedMps: number;
  finished: boolean;
};

function stateAtRecordedTime(
  rideId: string,
  speedProfile: readonly SpeedSample[],
  targetTimeMs: number
): RidePlaybackState {
  const first = speedProfile[0];
  const last = speedProfile[speedProfile.length - 1];
  const timeMs = Math.max(first.timeMs, Math.min(last.timeMs, targetTimeMs));

  let low = 1;
  let high = speedProfile.length - 1;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (speedProfile[middle].timeMs < timeMs) low = middle + 1;
    else high = middle;
  }

  const nextIndex = low;
  const next = speedProfile[Math.min(nextIndex, speedProfile.length - 1)];
  const previous = speedProfile[Math.max(0, nextIndex - 1)];
  const durationMs = next.timeMs - previous.timeMs;
  const fraction = durationMs > 0 ? (timeMs - previous.timeMs) / durationMs : 0;

  return {
    rideId,
    timeMs,
    arcLengthMeters:
      previous.arcLengthMeters +
      (next.arcLengthMeters - previous.arcLengthMeters) * fraction,
    speedMps: previous.speedMps + (next.speedMps - previous.speedMps) * fraction,
    finished: timeMs >= last.timeMs,
  };
}

export function initialRidePlaybackState(
  rideId: string,
  pass: Pass,
  speedProfile: readonly SpeedSample[]
): RidePlaybackState {
  if (pass.samples.length < 2 || speedProfile.length < 2) {
    const first = speedProfile[0];
    return {
      rideId,
      timeMs: first?.timeMs ?? pass.samples[0]?.timeMs ?? 0,
      arcLengthMeters: first?.arcLengthMeters ?? pass.samples[0]?.arcLengthMeters ?? 0,
      speedMps: first?.speedMps ?? 0,
      finished: true,
    };
  }

  return stateAtRecordedTime(rideId, speedProfile, speedProfile[0].timeMs);
}

export function advanceRidePlayback(
  rideId: string,
  pass: Pass,
  speedProfile: readonly SpeedSample[],
  current: RidePlaybackState,
  dtSeconds: number
): RidePlaybackState {
  if (current.finished || speedProfile.length < 2 || dtSeconds <= 0) return current;
  return stateAtRecordedTime(rideId, speedProfile, current.timeMs + dtSeconds * 1000);
}
