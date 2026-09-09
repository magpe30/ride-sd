# Ride SD

A game-styled motorcycle route map for San Diego's canyon and mountain
roads — plus a real GPX analysis pipeline that turns your ride recordings
into corner-by-corner speed comparisons across sessions.

Built as a portfolio piece exploring the intersection of map/data
engineering and game-grade UI polish: a neon "night ride" HUD aesthetic,
road geometry sourced from real OpenStreetMap data, and a from-scratch
pipeline for map-matching, smoothing, and analyzing rider GPX traces.

## Features

**Map & routes**

- Custom dark "night ride" MapLibre style, derived from OpenFreeMap's
  free `liberty` style and repainted so the road network recedes into
  muted grey — letting a selected route's neon glow read as the focal
  point instead of competing with base-map clutter.
- Four real San Diego backcountry roads, each pulled from OpenStreetMap
  via the Overpass API and stitched into accurate, road-snapped
  geometry (no placeholder/straight-line routes):

  | Route | Distance | Corners |
  |---|---|---|
  | Palomar Mountain — South Grade / East Grade | 13.5 mi | 46 |
  | Sunrise Highway | 19.8 mi | 45 |
  | Montezuma Valley Road | 16.4 mi | 38 |
  | Banner Grade | 14.3 mi | 46 |

- Corner detection runs directly on that geometry (resampling + heading
  analysis) — no manual annotation, and it's the same math the GPX
  pipeline reuses for rider-side corner analysis.

**GPX ride analysis**

- Upload a `.gpx` recording and the app automatically detects which
  loaded route it belongs to, map-matches the noisy GPS trace onto the
  clean reference line, and splits it into direction-consistent passes
  (so an out-and-back ride becomes an ascent + a descent, correctly
  handling stops and GPS drift in between).
- Speed is derived from map-matched arc-length over time and smoothed
  with a Savitzky-Golay filter — preserves real corner-speed shape
  instead of just blurring the signal like a moving average would.
- Compare up to **3 rides** of the same route side by side: each ride
  renders as its own lane on the map (color-coded, speed-gradient
  line), and the **Corners** panel breaks down every corner's approach,
  min/median/max, exit, speed lost/gained, and an estimated lean angle,
  per ride. Click a corner to zoom the map to it.
- GPX files never leave your browser and are never written to the
  repo — everything runs client-side.

## Tech stack

- [Next.js 16](https://nextjs.org) (App Router) + React 19 + TypeScript
- [MapLibre GL JS](https://maplibre.org/) for rendering, styled with a
  custom dark theme (no Mapbox, no API token required)
- [OpenFreeMap](https://openfreemap.org/) for base map tiles and
  [OpenStreetMap](https://www.openstreetmap.org/) (via the Overpass
  API) for route geometry — both free, no account needed
- Tailwind CSS v4 for layout utilities, hand-written CSS for the HUD
  design system
- No backend, no database — route data and the GPX pipeline are all
  static/client-side

## Getting started

Requires Node 20+.

```bash
git clone https://github.com/magpe30/ride-sd.git
cd ride-sd
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). The map style and
vendored MapLibre worker files are regenerated automatically before
`dev`/`build` (see `predev`/`prebuild` in `package.json`) — there's
nothing else to configure.

```bash
npm run build   # production build
npm run start   # serve the production build
npm run lint    # eslint
```

## Project structure

```
app/                    Next.js App Router pages
components/
  map/RideMap.tsx       MapLibre instance: routes, ride traces, corner highlight/markers
  panel/                RoutePanel, UploadPanel, CornerPanel (the HUD chrome)
data/
  routes.ts             Route metadata + per-route direction labels
  geo/*.json            Road-snapped route geometry (generated, checked in)
lib/
  geo/                  Pure geometry math: distance, bearing, arc-length, corner detection
  gpx/                  GPX parse → map-match → pass-segment → smooth → per-corner metrics
scripts/
  style/build-style.mjs       Repaints OpenFreeMap's style into the app's dark theme
  data/fetch-osm-routes.mjs   One-off tool: pulls + stitches route geometry from Overpass
  copy-maplibre-worker.mjs    Vendors MapLibre's worker files into public/
```

## How the map data is built

Nothing here is hand-drawn. Route geometry comes from
`scripts/data/fetch-osm-routes.mjs`, a one-off script (not part of the
dev/build pipeline — it needs network access) that queries Overpass for
named road segments and auto-stitches them into one ordered line,
walking shared endpoints and — for roads split into a dozen-plus
segments — picking the straightest continuation at each junction. The
output is committed to `data/geo/*.json` so the app has zero runtime
dependency on Overpass.

The map's visual style comes from `scripts/style/build-style.mjs`,
which *does* run before every `dev`/`build`: it reads a checked-in copy
of OpenFreeMap's `liberty` style and reassigns colors per layer
category (roads, water, terrain, labels) into the app's dark palette.

## GPX ride analysis pipeline

For the curious — the full path from a raw `.gpx` file to a per-corner
comparison, all in `lib/gpx/`:

1. **`parse.ts`** — reads `<trkpt>` elements via the browser's native
   `DOMParser`.
2. **`mapMatch.ts`** — projects each GPS point onto the nearest point of
   the route's reference line, giving it an arc-length (distance along
   the road) and a lateral offset. Points too far from the road are
   dropped, and arc-length "teleports" (a GPS point snapping onto the
   wrong nearby strand of a switchback) are rejected.
3. **`passes.ts`** — splits the map-matched track into direction-
   consistent passes, debounced so a brief repositioning during a stop
   doesn't register as a false reversal.
4. **`speed.ts` / `smoothing.ts`** — derives speed from arc-length over
   time and smooths it with a Savitzky-Golay filter.
5. **`cornerMetrics.ts` / `compareCorners.ts`** — samples the smoothed
   speed profile at each corner's boundaries (from `lib/geo/corners.ts`)
   and builds the cross-ride comparison shown in the Corners panel.

Every stage was validated against real ride recordings, not synthetic
data — see commit history for the specific bugs that surfaced along the
way (a terminus-orientation bug in the pass-segmentation walk, a
`map.isStyleLoaded()` timing gotcha, GPS-vs-reference-line rendering
noise) and how they were caught.

## Acknowledgments

- [OpenFreeMap](https://openfreemap.org/) and
  [OpenStreetMap](https://www.openstreetmap.org/) contributors for free
  map data with no token/account required
- [MapLibre GL JS](https://maplibre.org/)
