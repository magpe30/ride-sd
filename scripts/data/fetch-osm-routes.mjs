// One-off data acquisition tool — NOT part of the dev/build pipeline.
// Pulls real road-snapped geometry for named rides from OpenStreetMap's
// public Overpass API (free, no token/account) and stitches the matched
// way segments into a single ordered LineString per route.
//
// Usage: node scripts/data/fetch-osm-routes.mjs
//
// Two ways to define a route:
//   - `wayIds`: an explicit, manually-verified list of OSM way IDs in
//     order (used when a route only has a handful of segments and it's
//     easy to eyeball that they chain endpoint-to-endpoint).
//   - `query`: an Overpass QL snippet (e.g. by name/ref within a bbox).
//     All matched ways are fetched and automatically stitched into a
//     single chain by walking shared endpoint coordinates — needed once
//     a road is split into a dozen-plus segments, where manual chaining
//     stops being practical. At a fork (more than one continuation),
//     the walk continues in whichever direction keeps the bearing most
//     consistent, treating any other option as a spur.
//
// Re-run this script if OSM geometry changes, or add a new ROUTES entry
// to pull another ride.
import { writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const OVERPASS_URL = "https://overpass-api.de/api/interpreter";

const ROUTES = [
  {
    slug: "palomar-mountain-loop",
    name: "Palomar Mountain — South Grade / East Grade",
    // In order: South Grade Rd (CR S6) climbing from Hwy 76, a short
    // junction connector, then East Grade Rd (CR S7) descending toward
    // Hwy 79 near Lake Henshaw. Confirmed contiguous via shared endpoint
    // coordinates in the raw Overpass response.
    wayIds: [5990526, 178085626, 1503246961, 5959579, 6048217],
  },
  {
    slug: "sunrise-highway",
    name: "Sunrise Highway",
    query: `way["name"="Sunrise Highway"](32.60,-116.55,32.95,-116.35);`,
  },
  {
    slug: "montezuma-valley-road",
    name: "Montezuma Valley Road",
    // "Montezuma Valley Road" (the approach from the Santa Ysabel side)
    // and "Montezuma-Borrego Highway" (the switchback grade itself) are
    // two names for one continuous descent into Borrego Springs. Excludes
    // "Palm Canyon Drive"/"Christmas Circle", the in-town Borrego Springs
    // streets the road becomes after the grade ends.
    query: `way["name"~"^Montezuma Valley Road$|^Montezuma-Borrego Highway$"](33.10,-116.55,33.30,-116.30);`,
  },
  {
    slug: "banner-grade",
    name: "Banner Grade",
    // The CA-78 switchback grade east of Julian down to Scissors Crossing
    // (the S2 junction) — mapped in OSM as "Banner Road"/"Banner Grade",
    // plus the short "Route 78" segment right at the S2 junction. This
    // deliberately excludes "Julian Highway"/"Julian Road"/"Washington
    // Street"/"Main Street", which are the in-town Julian segments of the
    // same CA-78/79 ref, not the grade itself.
    query: `
      way["name"~"^Banner (Road|Grade)$"](33.00,-116.65,33.15,-116.45);
      way["name"="Route 78"](33.00,-116.65,33.15,-116.45);
    `,
  },
];

async function overpassFetch(query) {
  const response = await fetch(OVERPASS_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "*/*",
      "User-Agent": "ride-sd-portfolio-data-fetch (one-off script)",
    },
    body: new URLSearchParams({ data: query }),
  });

  if (!response.ok) {
    throw new Error(`Overpass request failed: ${response.status}`);
  }

  return response.json();
}

async function fetchWayGeometry(wayId) {
  const body = await overpassFetch(`[out:json][timeout:60];way(${wayId});out geom;`);
  const way = body.elements[0];

  if (!way) {
    throw new Error(`Way ${wayId} not found in Overpass response`);
  }

  return way.geometry.map((point) => [point.lon, point.lat]);
}

async function fetchWaysByQuery(query) {
  const body = await overpassFetch(`[out:json][timeout:90];(${query});out geom;`);
  return body.elements.map((el) => ({
    id: el.id,
    name: el.tags?.name,
    coords: el.geometry.map((point) => [point.lon, point.lat]),
  }));
}

const pointKey = ([lon, lat]) => `${lon.toFixed(7)},${lat.toFixed(7)}`;

function bearing([lon1, lat1], [lon2, lat2]) {
  return Math.atan2(lon2 - lon1, lat2 - lat1);
}

function angleDiff(a, b) {
  let diff = Math.abs(a - b);
  if (diff > Math.PI) diff = 2 * Math.PI - diff;
  return diff;
}

// Walks a set of ways end-to-end via shared endpoint coordinates,
// preferring the straightest continuation at any fork. Returns the
// longest chain found (by point count), plus any ways left unused.
function autoStitchWays(ways) {
  const remaining = new Set(ways.map((_, i) => i));
  const endpointIndex = new Map();

  ways.forEach((way, i) => {
    for (const end of ["start", "end"]) {
      const point = end === "start" ? way.coords[0] : way.coords[way.coords.length - 1];
      const k = pointKey(point);
      if (!endpointIndex.has(k)) endpointIndex.set(k, []);
      endpointIndex.get(k).push({ wayIndex: i, end });
    }
  });

  const termini = [...endpointIndex.entries()].filter(([, arr]) => arr.length === 1);

  function walkFrom(startWayIndex, startFromEnd) {
    const used = new Set();
    let currentWay = ways[startWayIndex];
    // Orient the way so the starting terminus lands at coords[0] and we
    // walk outward from its far end.
    let coords =
      startFromEnd === "end" ? [...currentWay.coords].reverse() : [...currentWay.coords];
    used.add(startWayIndex);

    let currentPoint = coords[coords.length - 1];
    let incomingBearing = bearing(coords[coords.length - 2], currentPoint);

    while (true) {
      const candidates = (endpointIndex.get(pointKey(currentPoint)) ?? []).filter(
        ({ wayIndex }) => !used.has(wayIndex)
      );

      if (candidates.length === 0) break;

      let best = candidates[0];
      if (candidates.length > 1) {
        best = candidates.reduce((a, b) => {
          const bearingFor = (candidate) => {
            const way = ways[candidate.wayIndex];
            const next = candidate.end === "start" ? way.coords[1] : way.coords[way.coords.length - 2];
            return bearing(currentPoint, next);
          };
          const diffA = angleDiff(incomingBearing, bearingFor(a));
          const diffB = angleDiff(incomingBearing, bearingFor(b));
          return diffA <= diffB ? a : b;
        });
      }

      const nextWay = ways[best.wayIndex];
      const nextCoords = best.end === "start" ? nextWay.coords : [...nextWay.coords].reverse();
      used.add(best.wayIndex);
      coords.push(...nextCoords.slice(1));
      currentPoint = coords[coords.length - 1];
      incomingBearing = bearing(coords[coords.length - 2], currentPoint);
    }

    return { coords, used };
  }

  let best = null;
  const startCandidates = termini.length > 0 ? termini : [...endpointIndex.entries()];

  for (const [, arr] of startCandidates) {
    for (const { wayIndex, end } of arr) {
      const result = walkFrom(wayIndex, end);
      if (!best || result.coords.length > best.coords.length) {
        best = result;
      }
    }
  }

  const unused = [...remaining].filter((i) => !best.used.has(i)).map((i) => ways[i].id);

  return { coordinates: best.coords, unused };
}

function haversineMiles([lon1, lat1], [lon2, lat2]) {
  const toRad = (deg) => (deg * Math.PI) / 180;
  const earthRadiusMiles = 3958.8;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return earthRadiusMiles * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function totalDistanceMiles(coordinates) {
  let total = 0;
  for (let i = 1; i < coordinates.length; i += 1) {
    total += haversineMiles(coordinates[i - 1], coordinates[i]);
  }
  return total;
}

async function resolveCoordinates(route) {
  if (route.wayIds) {
    const segments = [];
    for (const wayId of route.wayIds) {
      segments.push(await fetchWayGeometry(wayId));
    }

    const coordinates = [];
    for (const segment of segments) {
      const last = coordinates[coordinates.length - 1];
      const first = segment[0];
      const startIndex = last && last[0] === first[0] && last[1] === first[1] ? 1 : 0;
      coordinates.push(...segment.slice(startIndex));
    }
    return coordinates;
  }

  const ways = await fetchWaysByQuery(route.query);
  const { coordinates, unused } = autoStitchWays(ways);

  if (unused.length > 0) {
    console.warn(
      `  note: ${unused.length} way(s) not part of the main chain for "${route.slug}" (spurs/disconnected): ${unused.join(", ")}`
    );
  }

  return coordinates;
}

async function buildRoute(route) {
  const coordinates = await resolveCoordinates(route);

  const feature = {
    type: "Feature",
    properties: {
      name: route.name,
      distanceMiles: Math.round(totalDistanceMiles(coordinates) * 10) / 10,
    },
    geometry: {
      type: "LineString",
      coordinates,
    },
  };

  const outputPath = fileURLToPath(
    new URL(`../../data/geo/${route.slug}.json`, import.meta.url)
  );
  await writeFile(outputPath, JSON.stringify(feature, null, 2) + "\n");
  console.log(
    `Wrote ${outputPath} (${coordinates.length} points, ${feature.properties.distanceMiles} mi)`
  );
}

for (const route of ROUTES) {
  await buildRoute(route);
}
