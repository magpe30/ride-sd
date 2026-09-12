"use client";

import { useEffect, useRef } from "react";
import {
  type ExpressionSpecification,
  GeoJSONSource,
  LngLatBoundsLike,
  Map as MapLibreMap,
  Marker,
  setWorkerUrl,
} from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";

import { routes, type Route } from "@/data/routes";
import { detectCorners, type Corner } from "@/lib/geo/corners";
import {
  bearingDegrees,
  cumulativeDistancesMeters,
  pointAtArcLength,
  sliceLineByArcLength,
} from "@/lib/geo/measure";
import type { Pass } from "@/lib/gpx/passes";
import {
  buildSpeedTrace,
  offsetCoordinatesPerpendicular,
  positionAtArcLength,
} from "@/lib/gpx/renderTrace";
import type { LoadedRide } from "@/lib/gpx/session";

import type { PlaybackEngine } from "../playback/usePlaybackEngine";

setWorkerUrl("/maplibre/maplibre-gl-worker.mjs");

const SELECTED_ROUTE_SOURCE = "selected-route";
const CORNER_HIGHLIGHT_SOURCE = "corner-highlight";
const CORNER_MARKERS_SOURCE = "corner-markers";
// Keeps a highlighted corner clear of the fixed side panels (~320px)
// instead of centering it under them.
const CORNER_ZOOM_PADDING = { top: 100, bottom: 100, left: 340, right: 340 };
// Scaled by the route's own length rather than fixed, so a 20-mile
// route doesn't zip by at the same speed as a 13-mile one — clamped so
// neither a short nor a very long route ends up feeling instant or
// dragging.
const ROUTE_DRAW_MS_PER_MILE = 320;
const ROUTE_DRAW_MIN_DURATION_MS = 2800;
const ROUTE_DRAW_MAX_DURATION_MS = 7000;
const UPLOADED_PASS_PREFIX = "uploaded-pass-";
// Visual separation between rides of the same road, so overlapping
// traces read as parallel lanes instead of one occluding the others.
const RIDE_LANE_OFFSET_METERS = 10;

function routeDrawDurationMs(distanceMiles: number): number {
  return Math.min(
    ROUTE_DRAW_MAX_DURATION_MS,
    Math.max(ROUTE_DRAW_MIN_DURATION_MS, distanceMiles * ROUTE_DRAW_MS_PER_MILE)
  );
}

// Drawn top-down (like Uber/Google Maps' moving-vehicle markers, not a
// side profile) with the nose at the top of the viewBox — so rotation
// 0 = pointing north, matching bearingDegrees()'s convention directly,
// with no offset needed. Shaded body + a rear "tail light" accent for
// the same at-a-glance "which end is the front" read Uber's own
// vehicle marker uses.
const RIDER_ICON_SVG = `
  <svg viewBox="0 0 24 40" width="24" height="40">
    <defs>
      <linearGradient id="riderBody" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="#ffffff" />
        <stop offset="55%" stop-color="#e9e2fb" />
        <stop offset="100%" stop-color="#b9a3ef" />
      </linearGradient>
    </defs>
    <ellipse cx="12" cy="34" rx="4.5" ry="3" fill="#0a0e13" />
    <ellipse cx="12" cy="7" rx="4" ry="2.6" fill="#0a0e13" />
    <line x1="5" y1="8" x2="19" y2="8" stroke="#ffffff" stroke-width="2" stroke-linecap="round" />
    <path
      d="M12 5 L16.5 13 L15 31 Q12 34 9 31 L7.5 13 Z"
      fill="url(#riderBody)"
      stroke="#ffffff"
      stroke-width="0.8"
    />
    <path d="M9.5 10.5 L14.5 10.5 L13.3 15 L10.7 15 Z" fill="#241f3d" opacity="0.75" />
    <rect x="9.5" y="29.5" width="5" height="2.4" rx="1.2" fill="#ff3b3b" />
  </svg>
`;

function boundsFromCoordinates(
  coordinates: readonly (readonly number[])[]
): LngLatBoundsLike {
  let minLng = Infinity;
  let minLat = Infinity;
  let maxLng = -Infinity;
  let maxLat = -Infinity;

  for (const [lng, lat] of coordinates) {
    minLng = Math.min(minLng, lng);
    minLat = Math.min(minLat, lat);
    maxLng = Math.max(maxLng, lng);
    maxLat = Math.max(maxLat, lat);
  }

  return [
    [minLng, minLat],
    [maxLng, maxLat],
  ];
}

type RideMapProps = {
  selectedRouteId: string | null;
  onSelectRoute: (id: string) => void;
  loadedRides: LoadedRide[];
  selectedCorner: Corner | null;
  direction: Pass["direction"] | null;
  playbackEngine: PlaybackEngine;
};

// A lane-offset trace for one loaded ride's pass in the currently
// active direction — cached so the per-frame playback marker can be
// positioned by simple interpolation instead of recomputing the trace
// on every animation frame.
type RideTraceCache = {
  offsetCoordinates: [number, number][];
  arcLengthsMeters: number[];
  direction: Pass["direction"];
};

// How far back along the ride's own direction of travel to look when
// computing the playback marker's heading — mirrors the same
// tip/behind approach the route-draw animation uses.
const PLAYBACK_HEADING_LOOKBACK_METERS = 15;

export default function RideMap({
  selectedRouteId,
  onSelectRoute,
  loadedRides,
  selectedCorner,
  direction,
  playbackEngine,
}: RideMapProps) {
  const mapContainerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const selectRouteRef = useRef<(route: Route) => void>(() => {});
  const renderRidesRef = useRef<(loadedRides: LoadedRide[]) => void>(() => {});
  const highlightCornerRef = useRef<(corner: Corner | null, route: Route | null) => void>(
    () => {}
  );
  const renderCornerMarkersRef = useRef<(route: Route | null) => void>(() => {});
  const markersRef = useRef<Map<string, Marker>>(new Map());
  const uploadedLayerIdsRef = useRef<string[]>([]);
  const riderMarkerRef = useRef<Marker | null>(null);
  const rideTracesRef = useRef<Map<string, RideTraceCache>>(new Map());
  const rideMarkersRef = useRef<Map<string, Marker>>(new Map());
  // Lets drawRoute() (captured once at mount) see whether rides are
  // currently loaded without depending on the `loadedRides` prop
  // directly — once real ride data exists, its own per-ride playback
  // markers replace the generic single "previewing this route" rider,
  // so drawRoute skips creating/animating it.
  const hasLoadedRidesRef = useRef(false);
  // Bumped on every drawRoute() call so a stale in-flight animation
  // (e.g. the user clicks a different route before the first one
  // finishes) can recognize it's obsolete and stop updating anything.
  const routeAnimationTokenRef = useRef(0);
  // Our own "the initial style finished loading" flag. MapLibre's own
  // map.isStyleLoaded() is about render/tile-loading completion and can
  // transiently report false again after adding a source — it's not a
  // reliable "safe to call addSource" check beyond the very first load,
  // and map.once("load", ...) never fires a second time to rescue a
  // deferred call, so a naive retry-on-that-event silently drops it.
  const styleReadyRef = useRef(false);
  const pendingRidesRef = useRef<LoadedRide[] | null>(null);

  useEffect(() => {
    if (!mapContainerRef.current) return;

    const map = new MapLibreMap({
      container: mapContainerRef.current,
      style: "/map/style.json",
      center: [-117.05, 33.05],
      zoom: 8.5,
    });

    mapRef.current = map;
    const markers = markersRef.current;
    const rideMarkers = rideMarkersRef.current;

    map.on("load", () => {
      map.addSource(SELECTED_ROUTE_SOURCE, {
        type: "geojson",
        data: {
          type: "Feature",
          properties: {},
          geometry: {
            type: "LineString",
            coordinates: [],
          },
        },
      });

      map.addLayer({
        id: "selected-route-glow",
        type: "line",
        source: SELECTED_ROUTE_SOURCE,
        layout: {
          "line-join": "round",
          "line-cap": "round",
        },
        paint: {
          "line-color": "#ff2fb0",
          "line-width": 14,
          "line-blur": 6,
          "line-opacity": 0.35,
        },
      });

      map.addLayer({
        id: "selected-route-line",
        type: "line",
        source: SELECTED_ROUTE_SOURCE,
        layout: {
          "line-join": "round",
          "line-cap": "round",
        },
        paint: {
          "line-color": "#ff2fb0",
          "line-width": 4,
          "line-opacity": 0.95,
        },
      });

      map.addSource(CORNER_HIGHLIGHT_SOURCE, {
        type: "geojson",
        data: {
          type: "Feature",
          properties: {},
          geometry: { type: "LineString", coordinates: [] },
        },
      });

      map.addLayer({
        id: "corner-highlight-glow",
        type: "line",
        source: CORNER_HIGHLIGHT_SOURCE,
        layout: { "line-join": "round", "line-cap": "round" },
        paint: {
          "line-color": "#7c3aff",
          "line-width": 20,
          "line-blur": 12,
          "line-opacity": 0.55,
        },
      });

      map.addLayer({
        id: "corner-highlight-line",
        type: "line",
        source: CORNER_HIGHLIGHT_SOURCE,
        layout: { "line-join": "round", "line-cap": "round" },
        paint: {
          "line-color": "#ffffff",
          "line-width": 3,
          "line-opacity": 0.95,
        },
      });

      map.addSource(CORNER_MARKERS_SOURCE, {
        type: "geojson",
        data: { type: "FeatureCollection", features: [] },
      });

      const isSelected: ExpressionSpecification = [
        "boolean",
        ["feature-state", "selected"],
        false,
      ];

      map.addLayer({
        id: "corner-markers-badge",
        type: "circle",
        source: CORNER_MARKERS_SOURCE,
        // Hidden at the wide overview zoom (40+ numbers over 13 miles
        // would just be clutter) — they appear once you're zoomed in
        // enough to actually be looking at a stretch of road.
        minzoom: 11,
        paint: {
          "circle-radius": ["case", isSelected, 13, 9],
          "circle-color": ["case", isSelected, "#ff2fb0", "#7c3aff"],
          "circle-stroke-color": "#ffffff",
          "circle-stroke-width": ["case", isSelected, 2, 1.4],
        },
      });

      map.addLayer({
        id: "corner-markers",
        type: "symbol",
        source: CORNER_MARKERS_SOURCE,
        minzoom: 11,
        layout: {
          "text-field": ["get", "label"],
          "text-font": ["Noto Sans Regular"],
          // text-size is a layout property — feature-state expressions
          // only work in paint properties, so the "selected" emphasis
          // lives entirely on the badge (circle) layer below the text.
          "text-size": 12,
          "text-allow-overlap": true,
        },
        paint: {
          "text-color": "#ffffff",
        },
      });

      styleReadyRef.current = true;
      if (pendingRidesRef.current) {
        const pending = pendingRidesRef.current;
        pendingRidesRef.current = null;
        renderRidesRef.current(pending);
      }
    });

    const getRiderMarker = () => {
      if (riderMarkerRef.current) return riderMarkerRef.current;

      const el = document.createElement("div");
      el.className = "ride-rider-marker";
      el.innerHTML = RIDER_ICON_SVG;

      const marker = new Marker({ element: el, rotationAlignment: "map" });
      riderMarkerRef.current = marker;
      return marker;
    };

    const drawRoute = (route: Route) => {
      const source = map.getSource(SELECTED_ROUTE_SOURCE) as
        | GeoJSONSource
        | undefined;

      if (!source) return;

      const coordinates = route.line.coordinates;
      const startTime = performance.now();
      const durationMs = routeDrawDurationMs(route.distanceMiles);
      const token = ++routeAnimationTokenRef.current;

      // Once real ride data is loaded, each ride gets its own colored
      // playback marker (see the playback-engine subscription effect
      // below) — the generic preview rider would just be a second,
      // unrelated bike icon animating over the actual ride data.
      const rider = hasLoadedRidesRef.current ? null : getRiderMarker();
      rider?.setLngLat(coordinates[0] as [number, number]).addTo(map);

      const animate = (now: number) => {
        if (routeAnimationTokenRef.current !== token) return;

        const progress = Math.min(1, (now - startTime) / durationMs);
        const currentIndex = Math.max(1, Math.ceil(progress * coordinates.length));

        source.setData({
          type: "Feature",
          properties: {},
          geometry: {
            type: "LineString",
            coordinates: coordinates.slice(0, currentIndex),
          },
        });

        if (rider) {
          const tip = coordinates[currentIndex - 1];
          const behind = coordinates[Math.max(0, currentIndex - 3)];
          rider.setLngLat([tip[0], tip[1]]);
          if (behind[0] !== tip[0] || behind[1] !== tip[1]) {
            rider.setRotation(bearingDegrees(behind, tip));
          }
        }

        if (progress < 1) {
          requestAnimationFrame(animate);
        }
      };

      requestAnimationFrame(animate);
    };

    selectRouteRef.current = (route) => {
      map.fitBounds(boundsFromCoordinates(route.line.coordinates), {
        padding: 80,
        duration: 1800,
      });

      map.once("moveend", () => drawRoute(route));

      markers.forEach((marker, id) => {
        marker.getElement().classList.toggle("ride-marker--active", id === route.id);
      });
    };

    highlightCornerRef.current = (corner, route) => {
      const source = map.getSource(CORNER_HIGHLIGHT_SOURCE) as GeoJSONSource | undefined;
      if (!source) return;

      if (!corner || !route) {
        source.setData({
          type: "Feature",
          properties: {},
          geometry: { type: "LineString", coordinates: [] },
        });
        map.removeFeatureState({ source: CORNER_MARKERS_SOURCE });
        return;
      }

      const cumulative = cumulativeDistancesMeters(route.line.coordinates);
      const sliced = sliceLineByArcLength(
        route.line.coordinates,
        cumulative,
        corner.startArcLengthMeters,
        corner.endArcLengthMeters
      );
      const tuples = sliced.map((p) => [p[0], p[1]] as [number, number]);

      source.setData({
        type: "Feature",
        properties: {},
        geometry: { type: "LineString", coordinates: tuples },
      });

      // Make the selected corner's own number badge pop (bigger, brighter)
      // in addition to the glowing highlight line.
      map.removeFeatureState({ source: CORNER_MARKERS_SOURCE });
      map.setFeatureState({ source: CORNER_MARKERS_SOURCE, id: corner.index }, { selected: true });

      map.fitBounds(boundsFromCoordinates(tuples), {
        padding: CORNER_ZOOM_PADDING,
        maxZoom: 17,
        duration: 1000,
      });
    };

    renderCornerMarkersRef.current = (route) => {
      const source = map.getSource(CORNER_MARKERS_SOURCE) as GeoJSONSource | undefined;
      if (!source) return;

      if (!route) {
        source.setData({ type: "FeatureCollection", features: [] });
        return;
      }

      const corners = detectCorners(route.line.coordinates);
      const cumulative = cumulativeDistancesMeters(route.line.coordinates);

      source.setData({
        type: "FeatureCollection",
        features: corners.map((corner) => {
          const [lon, lat] = pointAtArcLength(
            route.line.coordinates,
            cumulative,
            corner.apexArcLengthMeters
          );
          return {
            type: "Feature",
            id: corner.index,
            properties: { label: String(corner.index) },
            geometry: { type: "Point", coordinates: [lon, lat] },
          };
        }),
      });
    };

    renderRidesRef.current = (loadedRides) => {
      if (!styleReadyRef.current) {
        pendingRidesRef.current = loadedRides;
        return;
      }

      for (const id of uploadedLayerIdsRef.current) {
        if (map.getLayer(id)) map.removeLayer(id);
        if (map.getSource(id)) map.removeSource(id);
      }
      uploadedLayerIdsRef.current = [];

      if (loadedRides.length === 0) return;

      loadedRides.forEach((loaded, rideIndex) => {
        // Center the group of lanes on the true road centerline.
        const laneOffsetMeters =
          (rideIndex - (loadedRides.length - 1) / 2) * RIDE_LANE_OFFSET_METERS;

        loaded.ride.passes.forEach((pass, passIndex) => {
          const { coordinates, colorStops } = buildSpeedTrace(
            pass.samples,
            pass.speedProfile,
            loaded.ride.route.line.coordinates
          );
          if (coordinates.length < 2 || colorStops.length < 2) return;

          const offsetCoordinates = offsetCoordinatesPerpendicular(coordinates, laneOffsetMeters);
          const id = `${UPLOADED_PASS_PREFIX}${loaded.id}-${passIndex}`;

          map.addSource(id, {
            type: "geojson",
            lineMetrics: true,
            data: {
              type: "Feature",
              properties: {},
              geometry: { type: "LineString", coordinates: offsetCoordinates },
            },
          });

          const gradient: unknown[] = ["interpolate", ["linear"], ["line-progress"]];
          for (const stop of colorStops) gradient.push(stop.progress, stop.color);

          map.addLayer({
            id,
            type: "line",
            source: id,
            layout: { "line-join": "round", "line-cap": "round" },
            paint: {
              "line-width": 5,
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              "line-gradient": gradient as any,
            },
          });

          uploadedLayerIdsRef.current.push(id);
        });
      });

      // Ride traces just got (re)added on top of everything — bring the
      // corner number labels and highlight back above them so they stay
      // readable instead of getting buried under the thick trace lines.
      if (map.getLayer("corner-highlight-glow")) map.moveLayer("corner-highlight-glow");
      if (map.getLayer("corner-highlight-line")) map.moveLayer("corner-highlight-line");
      if (map.getLayer("corner-markers-badge")) map.moveLayer("corner-markers-badge");
      if (map.getLayer("corner-markers")) map.moveLayer("corner-markers");

      const allCoordinates = loadedRides.flatMap((loaded) =>
        loaded.ride.passes.flatMap((pass) =>
          pass.samples.map((sample) => [sample.lon, sample.lat] as [number, number])
        )
      );
      if (allCoordinates.length > 0) {
        map.fitBounds(boundsFromCoordinates(allCoordinates), { padding: 80, duration: 1800 });
      }
    };

    routes.forEach((route) => {
      const markerElement = document.createElement("button");
      markerElement.className = "ride-marker";
      markerElement.innerHTML = `<span>${route.markerLabel}</span>`;

      markerElement.addEventListener("click", () => onSelectRoute(route.id));

      const marker = new Marker({ element: markerElement })
        .setLngLat(route.markerCoordinate)
        .addTo(map);

      markers.set(route.id, marker);
    });

    return () => {
      markers.forEach((marker) => marker.remove());
      markers.clear();
      riderMarkerRef.current?.remove();
      riderMarkerRef.current = null;
      rideMarkers.forEach((marker) => marker.remove());
      rideMarkers.clear();
      map.remove();
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!selectedRouteId) return;
    const route = routes.find((candidate) => candidate.id === selectedRouteId);
    if (route) selectRouteRef.current(route);
  }, [selectedRouteId]);

  useEffect(() => {
    renderRidesRef.current(loadedRides);
    hasLoadedRidesRef.current = loadedRides.length > 0;
    if (loadedRides.length > 0) {
      // A generic preview rider from browsing routes before any upload
      // would otherwise linger, stale, once real ride data takes over.
      riderMarkerRef.current?.remove();
      riderMarkerRef.current = null;
    }
  }, [loadedRides]);

  const activeRouteId = loadedRides[0]?.ride.route.id ?? null;

  useEffect(() => {
    const route = loadedRides[0]?.ride.route ?? null;
    renderCornerMarkersRef.current(route);
    // Corner markers depend only on which route is active, not on every
    // ride list change (adding/removing a ride of the same route
    // shouldn't recompute them).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeRouteId]);

  useEffect(() => {
    const route = loadedRides[0]?.ride.route ?? null;
    highlightCornerRef.current(selectedCorner, route);
  }, [selectedCorner, loadedRides]);

  // Caches each ride's lane-offset trace for whichever pass matches the
  // currently active direction, keyed by ride id — the playback marker
  // below reads from this instead of recomputing the trace every frame.
  // The lane-offset formula here must match the one renderRidesRef uses
  // for the static line so the animated marker rides exactly on top of
  // the line the user already sees, not a slightly different path.
  useEffect(() => {
    const traces = new Map<string, RideTraceCache>();

    if (direction) {
      loadedRides.forEach((loaded, rideIndex) => {
        const pass = loaded.ride.passes.find((p) => p.direction === direction);
        if (!pass) return;

        const trace = buildSpeedTrace(
          pass.samples,
          pass.speedProfile,
          loaded.ride.route.line.coordinates
        );
        if (trace.coordinates.length < 2) return;

        const laneOffsetMeters =
          (rideIndex - (loadedRides.length - 1) / 2) * RIDE_LANE_OFFSET_METERS;
        const offsetCoordinates = offsetCoordinatesPerpendicular(
          trace.coordinates,
          laneOffsetMeters
        );

        traces.set(loaded.id, {
          offsetCoordinates,
          arcLengthsMeters: trace.arcLengthsMeters,
          direction: pass.direction,
        });
      });
    }

    rideTracesRef.current = traces;
  }, [loadedRides, direction]);

  // Drives one marker per loaded ride from the playback engine's
  // per-frame state — imperative (no React state per frame) for the
  // same reason drawRoute()'s animation is: this needs to run at a
  // smooth 60fps without triggering a React re-render every frame.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const markers = rideMarkersRef.current;

    const unsubscribe = playbackEngine.subscribe((states) => {
      const activeIds = new Set(states.map((s) => s.rideId));

      markers.forEach((marker, id) => {
        if (!activeIds.has(id)) {
          marker.remove();
          markers.delete(id);
        }
      });

      for (const state of states) {
        const trace = rideTracesRef.current.get(state.rideId);
        if (!trace) continue;

        const traceLike = {
          coordinates: trace.offsetCoordinates,
          arcLengthsMeters: trace.arcLengthsMeters,
          colorStops: [],
        };
        const position = positionAtArcLength(traceLike, state.arcLengthMeters);
        if (!position) continue;

        let marker = markers.get(state.rideId);
        if (!marker) {
          const loaded = loadedRides.find((r) => r.id === state.rideId);
          const el = document.createElement("div");
          el.className = "ride-rider-marker";
          if (loaded) el.style.setProperty("--rider-glow-color", loaded.color);
          el.innerHTML = RIDER_ICON_SVG;
          marker = new Marker({ element: el, rotationAlignment: "map" });
          marker.setLngLat(position).addTo(map);
          markers.set(state.rideId, marker);
        } else {
          marker.setLngLat(position);
        }

        const directionSign = trace.direction === "forward" ? 1 : -1;
        const behindArc =
          state.arcLengthMeters - directionSign * PLAYBACK_HEADING_LOOKBACK_METERS;
        const behindPosition = positionAtArcLength(traceLike, behindArc);
        if (behindPosition && (behindPosition[0] !== position[0] || behindPosition[1] !== position[1])) {
          marker.setRotation(bearingDegrees(behindPosition, position));
        }
      }
    });

    return unsubscribe;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playbackEngine.subscribe, loadedRides]);

  return (
    <div
      ref={mapContainerRef}
      style={{
        width: "100vw",
        height: "100vh",
      }}
    />
  );
}
