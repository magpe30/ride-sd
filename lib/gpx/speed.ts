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

// The recorder stops emitting regular points during longer breaks. That
// produces two samples several minutes apart at almost the same place and
// makes a replay appear frozen even after its timeline is compressed. Treat
// only these unambiguous gaps as breaks; ordinary low-speed riding remains.
const MIN_STATIONARY_BREAK_MS = 30_000;
const MAX_BREAK_MOVEMENT_METERS = 25;
const STATIONARY_CLUSTER_RADIUS_METERS = 8;
const MAX_TYPICAL_SAMPLE_INTERVAL_MS = 5_000;

type IndexedSample = {
  sample: MatchedSample;
  originalIndex: number;
  bridgeFromPrevious: boolean;
};

function typicalSampleIntervalMs(samples: readonly MatchedSample[]): number {
  const intervals = samples
    .slice(1)
    .map((sample, index) => sample.timeMs - samples[index].timeMs)
    .filter((interval) => interval > 0 && interval <= MAX_TYPICAL_SAMPLE_INTERVAL_MS)
    .sort((a, b) => a - b);

  return intervals.length > 0 ? intervals[Math.floor(intervals.length / 2)] : 1_000;
}

/**
 * Collapses long, stationary recording gaps to one representative point.
 * Returned timestamps keep normal riding intervals but remove break duration.
 */
export function removeStationaryBreaks(
  samples: readonly MatchedSample[]
): MatchedSample[] {
  if (samples.length < 2) return [...samples];

  const ranges: Array<{ start: number; end: number }> = [];

  for (let index = 1; index < samples.length; index += 1) {
    const previous = samples[index - 1];
    const current = samples[index];
    const gapMs = current.timeMs - previous.timeMs;
    const movementMeters = Math.abs(current.arcLengthMeters - previous.arcLengthMeters);

    if (
      gapMs < MIN_STATIONARY_BREAK_MS ||
      movementMeters > MAX_BREAK_MOVEMENT_METERS
    ) {
      continue;
    }

    const anchorArc = (previous.arcLengthMeters + current.arcLengthMeters) / 2;
    let start = index - 1;
    let end = index;

    while (
      start > 0 &&
      Math.abs(samples[start - 1].arcLengthMeters - anchorArc) <=
        STATIONARY_CLUSTER_RADIUS_METERS
    ) {
      start -= 1;
    }

    while (
      end < samples.length - 1 &&
      Math.abs(samples[end + 1].arcLengthMeters - anchorArc) <=
        STATIONARY_CLUSTER_RADIUS_METERS
    ) {
      end += 1;
    }

    const previousRange = ranges[ranges.length - 1];
    if (previousRange && start <= previousRange.end + 1) {
      previousRange.end = Math.max(previousRange.end, end);
    } else {
      ranges.push({ start, end });
    }

    index = end;
  }

  if (ranges.length === 0) return [...samples];

  const kept: IndexedSample[] = [];
  let rangeIndex = 0;

  for (let index = 0; index < samples.length; index += 1) {
    const range = ranges[rangeIndex];
    if (!range || index < range.start) {
      kept.push({ sample: samples[index], originalIndex: index, bridgeFromPrevious: false });
      continue;
    }

    if (index === range.start) {
      const representativeIndex = range.end;
      kept.push({
        sample: samples[representativeIndex],
        originalIndex: representativeIndex,
        bridgeFromPrevious: kept.length > 0,
      });
      index = range.end;
      rangeIndex += 1;
      continue;
    }
  }

  const intervalMs = typicalSampleIntervalMs(samples);
  return kept.reduce<MatchedSample[]>((rebased, entry, index) => {
    if (index === 0) {
      rebased.push({ ...entry.sample, timeMs: samples[0].timeMs });
      return rebased;
    }

    const previous = rebased[index - 1];
    const rawPrevious = kept[index - 1].sample;
    const rawCurrent = entry.sample;
    const crossedCollapsedBreak =
      entry.bridgeFromPrevious ||
      entry.originalIndex - kept[index - 1].originalIndex > 1;
    const deltaMs = crossedCollapsedBreak
      ? intervalMs
      : rawCurrent.timeMs - rawPrevious.timeMs;
    rebased.push({ ...rawCurrent, timeMs: previous.timeMs + deltaMs });
    return rebased;
  }, []);
}

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

// Linearly interpolates speed at a target arc-length. `sortedByArc` must
// be sorted ascending by arcLengthMeters — shared by per-corner metrics
// (lib/gpx/cornerMetrics.ts) and ride playback (lib/gpx/playback.ts),
// which both need "how fast was this ride at this point on the road."
export function speedAtArcLengthMeters(
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
