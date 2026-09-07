// Derives a smoothed speed-vs-arc-length profile for a single pass.
// Raw speed comes from a central finite difference on map-matched
// arc-length (distance along the road) over time — using arc-length
// rather than raw lat/lon removes the lateral GPS jitter the map-match
// step already discarded, so this is a much cleaner signal than
// differencing raw GPS positions would give.
import type { MatchedSample } from "./mapMatch";
import { smoothSeries } from "./smoothing";

export type SpeedSample = {
  timeMs: number;
  arcLengthMeters: number;
  speedMps: number;
};

const SG_WINDOW_SAMPLES = 15;
const SG_POLY_ORDER = 2;

export function deriveSpeedProfile(samples: readonly MatchedSample[]): SpeedSample[] {
  if (samples.length < 3) return [];

  const rawSpeedsMps = samples.map((_, i) => {
    const prev = samples[Math.max(0, i - 1)];
    const next = samples[Math.min(samples.length - 1, i + 1)];
    const dtSeconds = (next.timeMs - prev.timeMs) / 1000;
    if (dtSeconds <= 0) return 0;
    const distanceMeters = Math.abs(next.arcLengthMeters - prev.arcLengthMeters);
    return distanceMeters / dtSeconds;
  });

  const smoothedMps = smoothSeries(rawSpeedsMps, SG_WINDOW_SAMPLES, SG_POLY_ORDER);

  return samples.map((sample, i) => ({
    timeMs: sample.timeMs,
    arcLengthMeters: sample.arcLengthMeters,
    speedMps: Math.max(0, smoothedMps[i]),
  }));
}
