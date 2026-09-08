// Manages the set of rides currently loaded for comparison: a shared
// cap, a stable identity color per ride (so removing one doesn't
// reshuffle the others'), and the "are these all the same road"
// invariant the UI needs to enforce on upload.
import type { AnalyzedRide } from "./analyzeRide";

export const MAX_LOADED_RIDES = 3;

// One color per ride slot — used as an identity accent in the ride list,
// and to offset each ride into its own visual "lane" on the map so
// multiple rides of the same physical road don't just overlap.
export const RIDE_COLORS = ["#2fe0ff", "#ff2fb0", "#ffb454"];

export type LoadedRide = {
  id: string;
  ride: AnalyzedRide;
  color: string;
};

export function nextAvailableColor(existing: readonly LoadedRide[]): string {
  const used = new Set(existing.map((loaded) => loaded.color));
  return RIDE_COLORS.find((color) => !used.has(color)) ?? RIDE_COLORS[0];
}

export function createLoadedRide(ride: AnalyzedRide, existing: readonly LoadedRide[]): LoadedRide {
  return {
    id: `${ride.route.id}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    ride,
    color: nextAvailableColor(existing),
  };
}
