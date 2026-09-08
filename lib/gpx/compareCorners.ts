// Builds per-corner comparison rows across the currently loaded rides.
// Corners are direction-aware (the same physical corner rides
// differently uphill vs downhill), so comparison only makes sense
// within a single direction at a time.
import type { Corner } from "../geo/corners";
import type { CornerMetrics } from "./cornerMetrics";
import type { Pass } from "./passes";
import type { LoadedRide } from "./session";

export type CornerComparisonEntry = {
  rideId: string;
  color: string;
  metrics: CornerMetrics;
};

export type CornerComparisonRow = {
  corner: Corner;
  entries: CornerComparisonEntry[];
};

export function availableDirections(loadedRides: readonly LoadedRide[]): Pass["direction"][] {
  const directions = new Set<Pass["direction"]>();
  for (const loaded of loadedRides) {
    for (const pass of loaded.ride.passes) directions.add(pass.direction);
  }
  return [...directions];
}

export function buildCornerComparison(
  loadedRides: readonly LoadedRide[],
  corners: readonly Corner[],
  direction: Pass["direction"]
): CornerComparisonRow[] {
  const rows: CornerComparisonRow[] = [];

  for (const corner of corners) {
    const entries: CornerComparisonEntry[] = [];

    for (const loaded of loadedRides) {
      const pass = loaded.ride.passes.find((p) => p.direction === direction);
      const metrics = pass?.cornerMetrics.find((m) => m.corner.index === corner.index);
      if (metrics) entries.push({ rideId: loaded.id, color: loaded.color, metrics });
    }

    if (entries.length > 0) rows.push({ corner, entries });
  }

  return rows;
}

// The ride with the highest min-speed through the corner — the closest
// single-number proxy for "carried the most corner speed here."
export function fastestRideId(entries: readonly CornerComparisonEntry[]): string | null {
  if (entries.length === 0) return null;
  return entries.reduce((best, entry) =>
    entry.metrics.minSpeedMps > best.metrics.minSpeedMps ? entry : best
  ).rideId;
}
