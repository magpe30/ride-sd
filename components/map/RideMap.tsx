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
// with no offset needed. Unlike a car, a motorcycle viewed strictly
// top-down is just a thin sliver — not very recognizable on its own —
// so a rider silhouette is drawn on top of the bike (the same trick
// Grab/Gojek's motorbike markers use).
//
// Volume is faked the way low-poly game icons do it, not with any real
// shading/rendering: every shape is angular (straight edges, not
// curves) and drawn twice — a dark "shadow" copy offset down-right,
// then the lit face on top — so a sliver of the dark copy peeks out
// along the bottom-right edges like a beveled, extruded block. A thin
// highlight stroke along the opposite (top-left) edge sells the same
// "light from upper-left" read. Ground shadow, headlight glow, and the
// per-ride color accent stripe are unchanged from the flat version.
const RIDER_ICON_SVG = `
  <svg viewBox="0 0 24 40" width="27" height="45">
    <defs>
      <linearGradient id="riderBody" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="#ffffff" />
        <stop offset="45%" stop-color="#ddd3fa" />
        <stop offset="100%" stop-color="#9c82e8" />
      </linearGradient>
    </defs>

    <ellipse cx="12" cy="35.5" rx="7" ry="2.3" fill="#000000" opacity="0.3" />

    <ellipse cx="13.1" cy="35.2" rx="4.5" ry="3" fill="#000000" opacity="0.55" />
    <ellipse cx="12" cy="34" rx="4.5" ry="3" fill="#100d1c" stroke="#4a4370" stroke-width="0.6" />
    <ellipse cx="12.7" cy="7.7" rx="4" ry="2.6" fill="#000000" opacity="0.55" />
    <ellipse cx="12" cy="7" rx="4" ry="2.6" fill="#100d1c" stroke="#4a4370" stroke-width="0.6" />

    <line x1="5" y1="8" x2="19" y2="8" stroke="#d8d0f2" stroke-width="2" stroke-linecap="round" />
    <rect x="3.6" y="6.9" width="2.4" height="2.4" rx="0.5" fill="#100d1c" />
    <rect x="18" y="6.9" width="2.4" height="2.4" rx="0.5" fill="#100d1c" />

    <rect x="15.6" y="25" width="2.2" height="6.4" rx="1" fill="#241f3d" opacity="0.9" />

    <path
      d="M12 5 L16.4 13 L16 23 L13.5 31 L10.5 31 L8 23 L7.6 13 Z"
      transform="translate(1.5, 1.8)"
      fill="#241f3d"
    />
    <path
      d="M12 5 L16.4 13 L16 23 L13.5 31 L10.5 31 L8 23 L7.6 13 Z"
      fill="url(#riderBody)"
      stroke="#ffffff"
      stroke-width="0.7"
    />
    <path
      d="M12 5 L7.6 13 L8 23"
      fill="none"
      stroke="#ffffff"
      stroke-width="0.6"
      stroke-linecap="round"
      opacity="0.7"
    />
    <path
      d="M12 8.5 L12 20"
      stroke="var(--rider-glow-color)"
      stroke-width="1.4"
      stroke-linecap="round"
      opacity="0.9"
    />

    <path
      d="M9.3 16.5 L14.7 16.5 L13.8 23 L12 25 L10.2 23 Z"
      transform="translate(0.9, 1.1)"
      fill="#0a0716"
      opacity="0.95"
    />
    <path d="M9.3 16.5 L14.7 16.5 L13.8 23 L12 25 L10.2 23 Z" fill="#1e1838" />

    <ellipse cx="13" cy="14.2" rx="2.6" ry="2.9" fill="#0a0716" />
    <ellipse cx="12" cy="13" rx="2.6" ry="2.9" fill="#211a3d" stroke="#ffffff" stroke-width="0.5" />
    <ellipse cx="12.7" cy="12.1" rx="1.05" ry="0.65" fill="#8fd8ff" opacity="0.85" />

    <circle cx="12" cy="5.3" r="2.2" fill="#ffffff" opacity="0.25" />
    <circle cx="12" cy="5.3" r="1.1" fill="#ffffff" />

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
  cameraMode: CameraMode;
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

// Two camera styles for following the lead ride during playback — an
// F1-broadcast-style flat "track map" overview (stable, always north-up,
// never rotates — closest to how those graphics actually look), and a
// pitched, close, bearing-following chase cam for a more dramatic replay.
// Both engage/disengage with an eased transition and otherwise update
// every frame via jumpTo (no easing needed there — the playback engine
// already delivers smooth per-frame positions).
export type CameraMode = "overview" | "chase";

const CAMERA_TRANSITION_MS = 900;

const OVERVIEW_PITCH_DEGREES = 0;
const OVERVIEW_ZOOM = 15.4;
// Fixed, not "whatever the map's bearing happened to be" — a broadcast
// track map never rotates, which is the whole reason it stays readable
// at a glance while the chase cam doesn't.
const OVERVIEW_BEARING_DEGREES = 0;

const CHASE_PITCH_DEGREES = 60;
const CHASE_ZOOM = 17.5;

// A camera that snaps exactly onto the rider's true position every
// frame holds it dead-center on screen at all times, by construction —
// there is no possible visual cue for speeding up or slowing down,
// since the rider can never move within the frame. Instead the camera
// eases toward the rider each frame (exponential smoothing, not an
// easeTo animation — this runs every frame, easeTo is for one-off
// transitions), letting it lag slightly behind on acceleration and
// coast up on deceleration — same principle as a real chase cam, and
// on its own it's one real cue that speed changes rather than just
// knowable from a number. Used for both camera modes' position follow;
// only chase mode additionally lags bearing/zoom.
const FOLLOW_POSITION_LAG = 0.06;

// The dominant speed cue in chase mode: pulling back at speed and
// tightening up through corners is the standard racing-game trick for
// making speed *felt* rather than just visible — it changes how fast
// the whole scene sweeps past, not just where the rider sits in frame.
// Speeds are mapped from what these routes actually produce
// (~10-55mph); a smoothed value is used for the same jitter reasons as
// position/bearing. The overview camera deliberately skips all of this
// — it's meant to read like a stable broadcast graphic, not a
// racing-game camera.
const CHASE_BEARING_LAG = 0.1;
const CHASE_ZOOM_LAG = 0.05;
const CHASE_ZOOM_MIN_MPH = 10;
const CHASE_ZOOM_MAX_MPH = 55;
const CHASE_ZOOM_AT_MIN_SPEED = 18.4;
const CHASE_ZOOM_AT_MAX_SPEED = 16.4;
const MPS_TO_MPH = 2.23694;

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function targetChaseZoom(speedMps: number): number {
  const mph = speedMps * MPS_TO_MPH;
  const t = clamp(
    (mph - CHASE_ZOOM_MIN_MPH) / (CHASE_ZOOM_MAX_MPH - CHASE_ZOOM_MIN_MPH),
    0,
    1
  );
  return lerp(CHASE_ZOOM_AT_MIN_SPEED, CHASE_ZOOM_AT_MAX_SPEED, t);
}

// Shortest-path interpolation between two compass bearings, so easing
// from 350° to 10° turns through 0° (20° of travel) rather than the
// long way back through 180°.
function lerpBearingDegrees(a: number, b: number, t: number): number {
  const delta = ((((b - a) % 360) + 540) % 360) - 180;
  return a + delta * t;
}

type CameraSnapshot = {
  center: [number, number];
  zoom: number;
  pitch: number;
  bearing: number;
};

export default function RideMap({
  selectedRouteId,
  onSelectRoute,
  loadedRides,
  selectedCorner,
  direction,
  playbackEngine,
  cameraMode,
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
  const speedLabelMarkersRef = useRef<Map<string, Marker>>(new Map());
  // Kept in sync via effect (see below) so the high-frequency playback
  // subscription callback can read the current camera mode without
  // itself depending on it — resubscribing every toggle click would
  // work but this avoids the churn, matching the playingRef pattern.
  const cameraModeRef = useRef<CameraMode>(cameraMode);
  const followActiveRef = useRef(false);
  // Which mode the camera is actually eased into right now — compared
  // against cameraModeRef every frame so a toggle mid-playback is
  // picked up on the next frame and re-eases into the new mode, the
  // same way first engaging the camera does.
  const followModeRef = useRef<CameraMode>("overview");
  // True only while the entrance easeTo (flat overview -> follow view,
  // or a mode switch between the two follow views) is still animating —
  // per-frame jumpTo calls are held off until it finishes, since any
  // camera method call interrupts an in-progress easeTo before it
  // reaches its target pitch/zoom.
  const followTransitioningRef = useRef(false);
  const preFollowCameraRef = useRef<CameraSnapshot | null>(null);
  // The camera's own (lagging) position/bearing while following — see
  // the FOLLOW_POSITION_LAG comment above for why this can't just be
  // the rider's true position every frame.
  const followCameraPositionRef = useRef<[number, number] | null>(null);
  const followCameraBearingRef = useRef<number | null>(null);
  const followCameraZoomRef = useRef<number | null>(null);
  // Kept in sync via effect (see below) so the high-frequency playback
  // subscription callback can read the current playing state without
  // itself depending on it — resubscribing every play/pause click would
  // work but this avoids the churn.
  const playingRef = useRef(false);
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
    const speedLabelMarkers = speedLabelMarkersRef.current;

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
      speedLabelMarkers.forEach((marker) => marker.remove());
      speedLabelMarkers.clear();
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

  useEffect(() => {
    cameraModeRef.current = cameraMode;
  }, [cameraMode]);

  useEffect(() => {
    playingRef.current = playbackEngine.playing;

    // Exiting follow mode has to live here, keyed on the (low-frequency,
    // ordinary React) `playing` value itself, rather than inside the
    // playback engine's per-frame subscription below: once playback
    // pauses or finishes, the engine stops producing frames entirely,
    // so that subscription's callback simply never fires again — there
    // would be no event left to trigger the "ease back" on.
    if (!playbackEngine.playing && followActiveRef.current) {
      followActiveRef.current = false;
      followTransitioningRef.current = false;
      followCameraPositionRef.current = null;
      followCameraBearingRef.current = null;
      followCameraZoomRef.current = null;
      const previous = preFollowCameraRef.current;
      preFollowCameraRef.current = null;
      if (previous) {
        mapRef.current?.easeTo({ ...previous, duration: CAMERA_TRANSITION_MS });
      }
    }
  }, [playbackEngine.playing]);

  // Drives one marker (plus a floating live-speed label) per loaded
  // ride, and the follow camera, from the playback engine's per-frame
  // state — imperative (no React state per frame) for the same reason
  // drawRoute()'s animation is: this needs to run at a smooth 60fps
  // without triggering a React re-render every frame.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const markers = rideMarkersRef.current;
    const speedLabels = speedLabelMarkersRef.current;
    const leadRideId = loadedRides[0]?.id;

    const unsubscribe = playbackEngine.subscribe((states) => {
      const activeIds = new Set(states.map((s) => s.rideId));

      markers.forEach((marker, id) => {
        if (!activeIds.has(id)) {
          marker.remove();
          markers.delete(id);
        }
      });
      speedLabels.forEach((label, id) => {
        if (!activeIds.has(id)) {
          label.remove();
          speedLabels.delete(id);
        }
      });

      let leadCameraUpdate:
        | { center: [number, number]; bearing?: number; speedMps: number }
        | null = null;

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

        const loaded = loadedRides.find((r) => r.id === state.rideId);

        let marker = markers.get(state.rideId);
        if (!marker) {
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

        // A small floating "NN mph" chip above the marker, like a
        // broadcast timing-tower readout — deliberately its own Marker
        // (default viewport-aligned rotation) rather than a child of
        // the rider icon's element, so it never rotates/tilts with the
        // bike's own heading.
        let speedLabel = speedLabels.get(state.rideId);
        if (!speedLabel) {
          const labelEl = document.createElement("div");
          labelEl.className = "ride-speed-label";
          if (loaded) labelEl.style.setProperty("--rider-glow-color", loaded.color);
          speedLabel = new Marker({ element: labelEl, anchor: "bottom", offset: [0, -30] });
          speedLabel.setLngLat(position).addTo(map);
          speedLabels.set(state.rideId, speedLabel);
        } else {
          speedLabel.setLngLat(position);
        }
        speedLabel.getElement().textContent = `${Math.round(state.speedMps * MPS_TO_MPH)} mph`;

        const directionSign = trace.direction === "forward" ? 1 : -1;
        const behindArc =
          state.arcLengthMeters - directionSign * PLAYBACK_HEADING_LOOKBACK_METERS;
        const behindPosition = positionAtArcLength(traceLike, behindArc);
        const hasHeading =
          behindPosition && (behindPosition[0] !== position[0] || behindPosition[1] !== position[1]);
        if (hasHeading) {
          marker.setRotation(bearingDegrees(behindPosition, position));
        }

        if (state.rideId === leadRideId) {
          leadCameraUpdate = {
            center: position as [number, number],
            bearing: hasHeading ? bearingDegrees(behindPosition, position) : undefined,
            speedMps: state.speedMps,
          };
        }
      }

      if (playingRef.current && leadCameraUpdate) {
        const desiredMode = cameraModeRef.current;
        const needsEngage = !followActiveRef.current || followModeRef.current !== desiredMode;

        if (needsEngage) {
          const isFirstEngage = !followActiveRef.current;
          followActiveRef.current = true;
          followModeRef.current = desiredMode;
          followTransitioningRef.current = true;
          // Only snapshot the pre-follow camera once, on the very first
          // engage — re-easing between overview and chase mid-playback
          // must not overwrite it with an already-in-follow state, or
          // disengaging later would "return" to a follow camera instead
          // of wherever the user actually had the map before pressing
          // play.
          if (isFirstEngage) {
            preFollowCameraRef.current = {
              center: map.getCenter().toArray() as [number, number],
              zoom: map.getZoom(),
              pitch: map.getPitch(),
              bearing: map.getBearing(),
            };
          }

          const targetBearing =
            desiredMode === "chase"
              ? (leadCameraUpdate.bearing ?? map.getBearing())
              : OVERVIEW_BEARING_DEGREES;
          const targetZoom = desiredMode === "chase" ? CHASE_ZOOM : OVERVIEW_ZOOM;
          const targetPitch = desiredMode === "chase" ? CHASE_PITCH_DEGREES : OVERVIEW_PITCH_DEGREES;

          // Seeded to the entrance's own target, not left null — the
          // first per-frame update after the transition should ease
          // from exactly where the entrance animation left off, not
          // snap from some earlier stale value.
          followCameraPositionRef.current = leadCameraUpdate.center;
          followCameraBearingRef.current = targetBearing;
          followCameraZoomRef.current = targetZoom;
          map.easeTo({
            center: leadCameraUpdate.center,
            zoom: targetZoom,
            pitch: targetPitch,
            bearing: targetBearing,
            duration: CAMERA_TRANSITION_MS,
          });
          map.once("moveend", () => {
            followTransitioningRef.current = false;
          });
        } else if (!followTransitioningRef.current) {
          // Eased toward the rider's true position rather than snapped
          // exactly onto it every frame — see FOLLOW_POSITION_LAG above
          // for why an exact snap would hold the rider dead-center on
          // screen at all times, with no visible cue for speed at all.
          const prevPosition = followCameraPositionRef.current ?? leadCameraUpdate.center;
          followCameraPositionRef.current = [
            lerp(prevPosition[0], leadCameraUpdate.center[0], FOLLOW_POSITION_LAG),
            lerp(prevPosition[1], leadCameraUpdate.center[1], FOLLOW_POSITION_LAG),
          ];

          if (followModeRef.current === "chase") {
            if (leadCameraUpdate.bearing !== undefined) {
              const prevBearing = followCameraBearingRef.current ?? leadCameraUpdate.bearing;
              followCameraBearingRef.current = lerpBearingDegrees(
                prevBearing,
                leadCameraUpdate.bearing,
                CHASE_BEARING_LAG
              );
            }

            const prevZoom = followCameraZoomRef.current ?? CHASE_ZOOM;
            followCameraZoomRef.current = lerp(
              prevZoom,
              targetChaseZoom(leadCameraUpdate.speedMps),
              CHASE_ZOOM_LAG
            );

            map.jumpTo({
              center: followCameraPositionRef.current,
              zoom: followCameraZoomRef.current,
              ...(followCameraBearingRef.current !== null
                ? { bearing: followCameraBearingRef.current }
                : {}),
            });
          } else {
            // Overview mode stays deliberately stable — fixed zoom,
            // fixed north-up bearing, position is the only thing that
            // follows — the point is a readable broadcast track map,
            // not a racing-game camera.
            map.jumpTo({ center: followCameraPositionRef.current });
          }
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
