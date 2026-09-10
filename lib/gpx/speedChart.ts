// Prepares per-ride speed-vs-distance series for the speed comparison
// chart: arc-length converted to miles, speed converted to mph, sorted
// so the chart can draw a clean line regardless of pass direction.
import type { Pass } from "./passes";
import type { LoadedRide } from "./session";

export type SpeedChartPoint = { miles: number; mph: number };

export type SpeedChartSeries = {
  rideId: string;
  color: string;
  label: string;
  points: SpeedChartPoint[];
};

const METERS_TO_MILES = 1 / 1609.344;
const MPS_TO_MPH = 2.23694;

export function buildSpeedChartSeries(
  loadedRides: readonly LoadedRide[],
  direction: Pass["direction"]
): SpeedChartSeries[] {
  const series: SpeedChartSeries[] = [];

  for (const loaded of loadedRides) {
    const pass = loaded.ride.passes.find((p) => p.direction === direction);
    if (!pass || pass.speedProfile.length === 0) continue;

    const sorted = [...pass.speedProfile].sort((a, b) => a.arcLengthMeters - b.arcLengthMeters);

    series.push({
      rideId: loaded.id,
      color: loaded.color,
      label: loaded.label,
      points: sorted.map((sample) => ({
        miles: sample.arcLengthMeters * METERS_TO_MILES,
        mph: sample.speedMps * MPS_TO_MPH,
      })),
    });
  }

  return series;
}

// Linear interpolation of mph at a target mile mark, for the hover
// readout. Assumes `points` is sorted ascending by miles.
export function mphAtMiles(points: readonly SpeedChartPoint[], targetMiles: number): number | null {
  if (points.length === 0) return null;
  if (targetMiles <= points[0].miles) return points[0].mph;
  const last = points[points.length - 1];
  if (targetMiles >= last.miles) return last.mph;

  for (let i = 1; i < points.length; i += 1) {
    if (points[i].miles >= targetMiles) {
      const a = points[i - 1];
      const b = points[i];
      const span = b.miles - a.miles;
      const t = span > 0 ? (targetMiles - a.miles) / span : 0;
      return a.mph + (b.mph - a.mph) * t;
    }
  }

  return last.mph;
}
