"use client";

import { useEffect, useRef } from "react";
import {
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
  cumulativeDistancesMeters,
  pointAtArcLength,
  sliceLineByArcLength,
} from "@/lib/geo/measure";
import { buildSpeedTrace, offsetCoordinatesPerpendicular } from "@/lib/gpx/renderTrace";
import type { LoadedRide } from "@/lib/gpx/session";

setWorkerUrl("/maplibre/maplibre-gl-worker.mjs");

const SELECTED_ROUTE_SOURCE = "selected-route";
const CORNER_HIGHLIGHT_SOURCE = "corner-highlight";
const CORNER_MARKERS_SOURCE = "corner-markers";
// Keeps a highlighted corner clear of the fixed side panels (~320px)
// instead of centering it under them.
const CORNER_ZOOM_PADDING = { top: 100, bottom: 100, left: 340, right: 340 };
const ROUTE_DRAW_DURATION_MS = 900;
const UPLOADED_PASS_PREFIX = "uploaded-pass-";
// Visual separation between rides of the same road, so overlapping
// traces read as parallel lanes instead of one occluding the others.
const RIDE_LANE_OFFSET_METERS = 10;

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
};

export default function RideMap({
  selectedRouteId,
  onSelectRoute,
  loadedRides,
  selectedCorner,
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

      map.addLayer({
        id: "corner-markers",
        type: "symbol",
        source: CORNER_MARKERS_SOURCE,
        // Hidden at the wide overview zoom (46 numbers over 13 miles
        // would just be clutter) — they appear once you're zoomed in
        // enough to actually be looking at a stretch of road.
        minzoom: 12,
        layout: {
          "text-field": ["get", "label"],
          "text-font": ["Noto Sans Regular"],
          "text-size": 13,
          "text-allow-overlap": true,
        },
        paint: {
          "text-color": "#ffffff",
          "text-halo-color": "#7c3aff",
          "text-halo-width": 2,
        },
      });

      styleReadyRef.current = true;
      if (pendingRidesRef.current) {
        const pending = pendingRidesRef.current;
        pendingRidesRef.current = null;
        renderRidesRef.current(pending);
      }
    });

    const drawRoute = (route: Route) => {
      const source = map.getSource(SELECTED_ROUTE_SOURCE) as
        | GeoJSONSource
        | undefined;

      if (!source) return;

      const coordinates = route.line.coordinates;
      const startTime = performance.now();

      const animate = (now: number) => {
        const progress = Math.min(1, (now - startTime) / ROUTE_DRAW_DURATION_MS);
        const currentIndex = Math.ceil(progress * coordinates.length);

        source.setData({
          type: "Feature",
          properties: {},
          geometry: {
            type: "LineString",
            coordinates: coordinates.slice(0, currentIndex),
          },
        });

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
      if (map.getLayer("corner-markers")) map.moveLayer("corner-markers");
      if (map.getLayer("corner-highlight-glow")) map.moveLayer("corner-highlight-glow");
      if (map.getLayer("corner-highlight-line")) map.moveLayer("corner-highlight-line");

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
