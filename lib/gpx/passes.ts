// Splits a map-matched track into distinct "passes" of a road — one
// contiguous, one-directional traversal each. A single GPX file often
// contains more than one: an out-and-back ride is an ascent pass and a
// descent pass, possibly with a stop at the top in between. Corner-level
// comparison only makes sense within a single direction, since the same
// physical corner rides differently uphill vs downhill.
//
// A stop mid-ride is not a new pass: it can include small real
// repositioning (rolling forward a few meters into a parking spot) that
// looks like a brief direction reversal, and can also produce a real
// time gap in the *matched* samples if the parked position drifts
// outside the map-match distance threshold. Direction only changes pass
// when it's sustained for a real distance, not a momentary wobble — see
// MIN_REVERSAL_METERS. A pathologically long gap (effectively a
// different leg of a trip) is the one case still forced to break.
import type { MatchedSample } from "./mapMatch";

export type Pass = {
  direction: "forward" | "reverse";
  samples: MatchedSample[];
};

const MAX_GAP_MS = 20 * 60_000;

// How far ahead/behind (in time) we look to judge the prevailing
// direction of travel at a given sample.
const TREND_WINDOW_MS = 30_000;

// Minimum net arc-length movement (meters) within the trend window to
// call a direction at all — below this we're stationary/noise.
const MIN_TREND_METERS = 10;

// A run of samples in the "wrong" direction shorter than this (net
// arc-length) is treated as a stop-time wobble, not a real reversal, and
// gets absorbed into the direction it interrupted.
const MIN_REVERSAL_METERS = 100;

// Minimum length for a pass to be worth keeping — filters out brief
// fragments (a GPS blip clipping the road before/after the real ride).
const MIN_PASS_METERS = 150;

type Direction = 1 | -1;

// Net arc-length change from ~TREND_WINDOW_MS behind `index` to
// ~TREND_WINDOW_MS ahead of it. Bridges gaps by falling back to the
// nearest available sample rather than losing signal there.
function trendAt(samples: readonly MatchedSample[], index: number): number {
  const t = samples[index].timeMs;

  let behind = index;
  while (behind > 0 && t - samples[behind].timeMs < TREND_WINDOW_MS) behind -= 1;

  let ahead = index;
  while (ahead < samples.length - 1 && samples[ahead].timeMs - t < TREND_WINDOW_MS) ahead += 1;

  return samples[ahead].arcLengthMeters - samples[behind].arcLengthMeters;
}

// Raw per-sample direction: 1, -1, or 0 (no clear signal — stationary).
function computeRawDirections(samples: readonly MatchedSample[]): (Direction | 0)[] {
  return samples.map((_, i) => {
    const trend = trendAt(samples, i);
    if (Math.abs(trend) < MIN_TREND_METERS) return 0;
    return trend > 0 ? 1 : -1;
  });
}

// Fills stationary (0) stretches with whichever direction was last
// confirmed, then collapses any run that doesn't cover enough net
// distance to count as a real reversal back into the direction it
// interrupted.
function resolveDirections(
  raw: readonly (Direction | 0)[],
  samples: readonly MatchedSample[]
): Direction[] {
  const filled: (Direction | null)[] = raw.map((d) => (d === 0 ? null : d));
  let last: Direction | null = null;
  for (let i = 0; i < filled.length; i += 1) {
    if (filled[i] === null) filled[i] = last;
    else last = filled[i] as Direction;
  }

  const firstKnown = filled.find((d) => d !== null) ?? 1;
  for (let i = 0; i < filled.length && filled[i] === null; i += 1) {
    filled[i] = firstKnown;
  }

  const resolved = filled as Direction[];

  let changed = true;
  while (changed) {
    changed = false;
    let i = 0;
    while (i < resolved.length) {
      let j = i;
      while (j < resolved.length && resolved[j] === resolved[i]) j += 1;

      const runSpanMeters = Math.abs(
        samples[j - 1].arcLengthMeters - samples[i].arcLengthMeters
      );

      if (i > 0 && runSpanMeters < MIN_REVERSAL_METERS) {
        const previousDirection = resolved[i - 1];
        for (let k = i; k < j; k += 1) resolved[k] = previousDirection;
        changed = true;
      }

      i = j;
    }
  }

  return resolved;
}

function passLengthMeters(pass: Pass): number {
  const arcLengths = pass.samples.map((s) => s.arcLengthMeters);
  return Math.max(...arcLengths) - Math.min(...arcLengths);
}

export function splitIntoPasses(samples: readonly MatchedSample[]): Pass[] {
  if (samples.length < 2) return [];

  const segments: MatchedSample[][] = [[samples[0]]];
  for (let i = 1; i < samples.length; i += 1) {
    if (samples[i].timeMs - samples[i - 1].timeMs > MAX_GAP_MS) segments.push([]);
    segments[segments.length - 1].push(samples[i]);
  }

  const passes: Pass[] = [];

  for (const segment of segments) {
    if (segment.length < 2) continue;

    const directions = resolveDirections(computeRawDirections(segment), segment);

    let start = 0;
    for (let i = 1; i <= segment.length; i += 1) {
      if (i < segment.length && directions[i] === directions[start]) continue;
      passes.push({
        direction: directions[start] > 0 ? "forward" : "reverse",
        samples: segment.slice(start, i),
      });
      start = i;
    }
  }

  return passes.filter((pass) => passLengthMeters(pass) >= MIN_PASS_METERS);
}
