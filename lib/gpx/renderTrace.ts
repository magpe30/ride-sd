// Builds a speed-colored line for a ride pass: the actual GPS path
// (deduplicated, since a stationary stretch can repeat the same point)
// paired with color stops for MapLibre's `line-gradient` paint property,
// which colors a line by normalized distance progress rather than by an
// arbitrary per-vertex value — so the stops here are speed colors placed
// at each point's progress along this specific line.
import {
  type Position,
  cumulativeDistancesMeters,
  haversineMeters,
  pointAtArcLength,
  toRadians,
} from "../geo/measure";
import type { MatchedSample } from "./mapMatch";
import type { SpeedSample } from "./speed";

export type SpeedColorStop = {
  progress: number;
  color: string;
};

export type SpeedTrace = {
  coordinates: [number, number][];
  colorStops: SpeedColorStop[];
  /** Each coordinate's original (pre-offset) arc-length, same order/length as `coordinates`. */
  arcLengthsMeters: number[];
};

// Slow -> neon-cyan, fast -> neon-magenta, very fast -> hot white —
// reuses the app's existing accent palette so an uploaded ride's colors
// read as part of the same visual system, not a bolted-on chart.
const SPEED_COLOR_STOPS: Array<{ mph: number; rgb: [number, number, number] }> = [
  { mph: 0, rgb: [47, 224, 255] },
  { mph: 45, rgb: [255, 47, 176] },
  { mph: 75, rgb: [255, 243, 232] },
];

const MPS_TO_MPH = 2.23694;

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function rgbToCss([r, g, b]: [number, number, number]): string {
  return `rgb(${Math.round(r)}, ${Math.round(g)}, ${Math.round(b)})`;
}

export function speedToColor(speedMps: number): string {
  const mph = speedMps * MPS_TO_MPH;
  const stops = SPEED_COLOR_STOPS;

  if (mph <= stops[0].mph) return rgbToCss(stops[0].rgb);
  if (mph >= stops[stops.length - 1].mph) return rgbToCss(stops[stops.length - 1].rgb);

  for (let i = 1; i < stops.length; i += 1) {
    if (mph <= stops[i].mph) {
      const t = (mph - stops[i - 1].mph) / (stops[i].mph - stops[i - 1].mph);
      return rgbToCss([
        lerp(stops[i - 1].rgb[0], stops[i].rgb[0], t),
        lerp(stops[i - 1].rgb[1], stops[i].rgb[1], t),
        lerp(stops[i - 1].rgb[2], stops[i].rgb[2], t),
      ]);
    }
  }

  return rgbToCss(stops[stops.length - 1].rgb);
}

export function buildSpeedTrace(
  samples: readonly MatchedSample[],
  speedProfile: readonly SpeedSample[],
  // When given, each sample is snapped to this arc-length position on the
  // reference line instead of using its raw (noisy) GPS coordinate. This
  // is what makes multiple rides of the same road render as clean,
  // directly comparable lanes instead of each carrying its own GPS
  // jitter and natural riding-line variance on top of the intentional
  // lane offset.
  referenceLine?: readonly Position[]
): SpeedTrace {
  const referenceCumulative = referenceLine ? cumulativeDistancesMeters(referenceLine) : null;

  const points: Array<{ lon: number; lat: number; speedMps: number; arcLengthMeters: number }> =
    [];

  for (let i = 0; i < samples.length; i += 1) {
    const sample = samples[i];
    const [lon, lat] =
      referenceLine && referenceCumulative
        ? pointAtArcLength(referenceLine, referenceCumulative, sample.arcLengthMeters)
        : [sample.lon, sample.lat];

    const previous = points[points.length - 1];
    if (previous && previous.lon === lon && previous.lat === lat) continue;
    points.push({ lon, lat, speedMps: speedProfile[i]?.speedMps ?? 0, arcLengthMeters: sample.arcLengthMeters });
  }

  if (points.length < 2) {
    return {
      coordinates: points.map((p) => [p.lon, p.lat]),
      colorStops: [],
      arcLengthsMeters: points.map((p) => p.arcLengthMeters),
    };
  }

  const cumulative = [0];
  for (let i = 1; i < points.length; i += 1) {
    cumulative.push(
      cumulative[i - 1] +
        haversineMeters([points[i - 1].lon, points[i - 1].lat], [points[i].lon, points[i].lat])
    );
  }
  const total = cumulative[cumulative.length - 1];

  const colorStops: SpeedColorStop[] = points.map((point, i) => ({
    progress: total > 0 ? cumulative[i] / total : 0,
    color: speedToColor(point.speedMps),
  }));

  // MapLibre requires strictly increasing stop values.
  for (let i = 1; i < colorStops.length; i += 1) {
    if (colorStops[i].progress <= colorStops[i - 1].progress) {
      colorStops[i].progress = colorStops[i - 1].progress + 1e-6;
    }
  }

  return {
    coordinates: points.map((p) => [p.lon, p.lat]),
    colorStops,
    arcLengthsMeters: points.map((p) => p.arcLengthMeters),
  };
}

// Interpolates a position along an already-built (and possibly
// lane-offset) trace at a given original arc-length — used to place a
// playback marker exactly on the same line the ride's trace draws,
// rather than recomputing an independent path. Works whether the
// trace's arc-lengths run ascending (forward pass) or descending
// (reverse pass); the target is clamped to whichever end of the
// covered range it's closest to if it falls outside it.
export function positionAtArcLength(
  trace: SpeedTrace,
  targetArcLengthMeters: number
): [number, number] | null {
  const { coordinates, arcLengthsMeters } = trace;
  if (coordinates.length === 0) return null;
  if (coordinates.length === 1) return coordinates[0];

  for (let i = 1; i < arcLengthsMeters.length; i += 1) {
    const a = arcLengthsMeters[i - 1];
    const b = arcLengthsMeters[i];
    const lo = Math.min(a, b);
    const hi = Math.max(a, b);
    if (targetArcLengthMeters >= lo && targetArcLengthMeters <= hi) {
      const span = b - a;
      const t = span !== 0 ? (targetArcLengthMeters - a) / span : 0;
      const pa = coordinates[i - 1];
      const pb = coordinates[i];
      return [pa[0] + (pb[0] - pa[0]) * t, pa[1] + (pb[1] - pa[1]) * t];
    }
  }

  const firstArc = arcLengthsMeters[0];
  const lastArc = arcLengthsMeters[arcLengthsMeters.length - 1];
  return Math.abs(targetArcLengthMeters - firstArc) <= Math.abs(targetArcLengthMeters - lastArc)
    ? coordinates[0]
    : coordinates[coordinates.length - 1];
}

const METERS_PER_DEGREE_LAT = 111320;

// Shifts a line sideways by a fixed distance, perpendicular to its local
// direction at each point. Multiple rides of the same physical road
// would otherwise draw exactly on top of each other — offsetting each
// ride into its own "lane" makes it possible to visually compare their
// speed colors at the same corner side by side instead of one occluding
// the others.
export function offsetCoordinatesPerpendicular(
  coordinates: readonly [number, number][],
  offsetMeters: number
): [number, number][] {
  if (offsetMeters === 0 || coordinates.length < 2) return coordinates.slice();

  return coordinates.map((point, i) => {
    const prev = coordinates[Math.max(0, i - 1)];
    const next = coordinates[Math.min(coordinates.length - 1, i + 1)];
    const metersPerDegLon = METERS_PER_DEGREE_LAT * Math.cos(toRadians(point[1]));

    const dx = (next[0] - prev[0]) * metersPerDegLon;
    const dy = (next[1] - prev[1]) * METERS_PER_DEGREE_LAT;
    const length = Math.hypot(dx, dy);
    if (length === 0) return point;

    // Rotate the local tangent 90° to get the perpendicular direction.
    const perpX = -dy / length;
    const perpY = dx / length;

    return [
      point[0] + (perpX * offsetMeters) / metersPerDegLon,
      point[1] + (perpY * offsetMeters) / METERS_PER_DEGREE_LAT,
    ] as [number, number];
  });
}
