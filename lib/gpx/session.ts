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
  /** Human-readable identity for lists/legends — the uploaded file's name. */
  label: string;
};

export function nextAvailableColor(existing: readonly LoadedRide[]): string {
  const used = new Set(existing.map((loaded) => loaded.color));
  return RIDE_COLORS.find((color) => !used.has(color)) ?? RIDE_COLORS[0];
}

// GPX exports often look like "Connected_20260118_090837_Jan_18_2026_at_9_08_AM.gpx"
// — pull out the readable date if it matches that shape, otherwise just
// strip the extension.
export function deriveRideLabel(filename: string): string {
  const withoutExtension = filename.replace(/\.gpx$/i, "");
  const dateMatch = withoutExtension.match(
    /([A-Z][a-z]{2})_(\d{1,2})_(\d{4})_at_(\d{1,2})_(\d{2})_(AM|PM)/
  );

  if (dateMatch) {
    const [, month, day, year, hour, minute, meridiem] = dateMatch;
    return `${month} ${day}, ${year} ${hour}:${minute} ${meridiem}`;
  }

  return withoutExtension;
}

export function createLoadedRide(
  ride: AnalyzedRide,
  existing: readonly LoadedRide[],
  label: string
): LoadedRide {
  return {
    id: `${ride.route.id}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    ride,
    color: nextAvailableColor(existing),
    label,
  };
}
