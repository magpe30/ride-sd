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
import { buildSpeedTrace, offsetCoordinatesPerpendicular } from "@/lib/gpx/renderTrace";
import type { LoadedRide } from "@/lib/gpx/session";

setWorkerUrl("/maplibre/maplibre-gl-worker.mjs");

const SELECTED_ROUTE_SOURCE = "selected-route";
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
};

export default function RideMap({ selectedRouteId, onSelectRoute, loadedRides }: RideMapProps) {
  const mapContainerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const selectRouteRef = useRef<(route: Route) => void>(() => {});
  const renderRidesRef = useRef<(loadedRides: LoadedRide[]) => void>(() => {});
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
