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

// Radius of the best-fit circle through a set of points (Kasa's
// algebraic method: minimize sum((x-cx)^2 + (y-cy)^2 - r^2)^2, which
// reduces to one 3x3 linear solve). Points are projected to a local
// planar (meters) frame around the first point first — at the scale of
// a single corner's local curvature (tens of meters) that's
// indistinguishable from the geodesic, and it's what lets more than
// three points contribute.
//
// A literal 3-point circumradius (the first thing tried here) turned
// out to be unusable: it's fully determined by whichever three points
// you pick, so a single point of GPS/digitization jitter can swing the
// radius wildly — verified against real ride data, it produced target
// corners bouncing between ~1 degree and ~48 degrees of estimated lean
// pass to pass on what should be the same fixed piece of road. Fitting
// a circle through a wider spread of points averages that noise out.
export function fitCircleRadiusMeters(points: readonly Position[]): number {
  if (points.length < 3) return Infinity;

  const [lon0, lat0] = points[0];
  const metersPerDegreeLat = 111320;
  const metersPerDegreeLon = 111320 * Math.cos(toRadians(lat0));
  const xy = points.map(([lon, lat]) => [
    (lon - lon0) * metersPerDegreeLon,
    (lat - lat0) * metersPerDegreeLat,
  ]);

  // Normal equations for minimizing sum(x^2 + y^2 + Dx + Ey + F)^2,
  // whose minimizer gives circle center (-D/2, -E/2) and radius
  // sqrt(D^2/4 + E^2/4 - F).
  let Sxx = 0, Sxy = 0, Syy = 0, Sx = 0, Sy = 0, Sxz = 0, Syz = 0, Sz = 0;
  for (const [x, y] of xy) {
    const z = x * x + y * y;
    Sxx += x * x;
    Sxy += x * y;
    Syy += y * y;
    Sx += x;
    Sy += y;
    Sxz += x * z;
    Syz += y * z;
    Sz += z;
  }
  const n = xy.length;

  // 3x3 linear solve via Cramer's rule.
  const a = [
    [Sxx, Sxy, Sx],
    [Sxy, Syy, Sy],
    [Sx, Sy, n],
  ];
  const b = [-Sxz, -Syz, -Sz];

  const det3 = (m: number[][]) =>
    m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1]) -
    m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0]) +
    m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0]);

  const determinant = det3(a);
  if (Math.abs(determinant) < 1e-9) return Infinity;

  const withColumn = (col: number, vec: number[]) =>
    a.map((row, i) => row.map((v, j) => (j === col ? vec[i] : v)));

  const D = det3(withColumn(0, b)) / determinant;
  const E = det3(withColumn(1, b)) / determinant;
  const F = det3(withColumn(2, b)) / determinant;

  const radiusSquared = (D * D + E * E) / 4 - F;
  return radiusSquared > 0 ? Math.sqrt(radiusSquared) : Infinity;
}

export function cumulativeDistancesMeters(coordinates: readonly Position[]): number[] {
  const cumulative = [0];
  for (let i = 1; i < coordinates.length; i += 1) {
    cumulative.push(cumulative[i - 1] + haversineMeters(coordinates[i - 1], coordinates[i]));
  }
  return cumulative;
}

// Inverse of arc-length parameterization: walks a line's precomputed
// cumulative distances to find the point at a given distance along it,
// interpolating within whichever segment contains that distance.
export function pointAtArcLength(
  line: readonly Position[],
  cumulative: readonly number[],
  targetArcLengthMeters: number
): Position {
  const total = cumulative[cumulative.length - 1];
  const clamped = Math.max(0, Math.min(total, targetArcLengthMeters));

  for (let i = 1; i < cumulative.length; i += 1) {
    if (cumulative[i] >= clamped) {
      const segStart = cumulative[i - 1];
      const segEnd = cumulative[i];
      const t = segEnd > segStart ? (clamped - segStart) / (segEnd - segStart) : 0;
      const a = line[i - 1];
      const b = line[i];
      return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
    }
  }

  return line[line.length - 1];
}

// Extracts the portion of a line between two arc-length positions,
// preserving the original vertices in that range (not just a straight
// chord between the endpoints) — used to highlight a specific corner's
// real geometry on the map.
export function sliceLineByArcLength(
  line: readonly Position[],
  cumulative: readonly number[],
  startMeters: number,
  endMeters: number
): Position[] {
  const result: Position[] = [pointAtArcLength(line, cumulative, startMeters)];

  for (let i = 0; i < line.length; i += 1) {
    if (cumulative[i] > startMeters && cumulative[i] < endMeters) result.push(line[i]);
  }

  result.push(pointAtArcLength(line, cumulative, endMeters));
  return result;
}
