// Shared geometry primitives for working with GeoJSON-style [lon, lat]
// positions: distance, bearing, and cumulative arc-length along a line.
// Used by both the reference-geometry corner analysis (lib/geo/corners.ts)
// and the GPX map-matching pipeline (lib/gpx/*), which both ultimately
// need "how far along this road is this point."
export type Position = readonly number[];

export const EARTH_RADIUS_METERS = 6371000;

export function toRadians(deg: number): number {
  return (deg * Math.PI) / 180;
}

export function toDegrees(rad: number): number {
  return (rad * 180) / Math.PI;
}

export function haversineMeters([lon1, lat1]: Position, [lon2, lat2]: Position): number {
  const dLat = toRadians(lat2 - lat1);
  const dLon = toRadians(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRadians(lat1)) * Math.cos(toRadians(lat2)) * Math.sin(dLon / 2) ** 2;
  return EARTH_RADIUS_METERS * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export function bearingDegrees([lon1, lat1]: Position, [lon2, lat2]: Position): number {
  const phi1 = toRadians(lat1);
  const phi2 = toRadians(lat2);
  const dLon = toRadians(lon2 - lon1);
  const y = Math.sin(dLon) * Math.cos(phi2);
  const x = Math.cos(phi1) * Math.sin(phi2) - Math.sin(phi1) * Math.cos(phi2) * Math.cos(dLon);
  return (toDegrees(Math.atan2(y, x)) + 360) % 360;
}

// Signed smallest angle from a to b, in (-180, 180].
export function angleDiffDegrees(a: number, b: number): number {
  let diff = ((b - a + 180) % 360) - 180;
  if (diff < -180) diff += 360;
  return diff;
}

export function cumulativeDistancesMeters(coordinates: readonly Position[]): number[] {
  const cumulative = [0];
  for (let i = 1; i < coordinates.length; i += 1) {
    cumulative.push(cumulative[i - 1] + haversineMeters(coordinates[i - 1], coordinates[i]));
  }
  return cumulative;
}
