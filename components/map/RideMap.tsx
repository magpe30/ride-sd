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

setWorkerUrl("/maplibre/maplibre-gl-worker.mjs");

const SELECTED_ROUTE_SOURCE = "selected-route";
const ROUTE_DRAW_DURATION_MS = 900;

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
};

export default function RideMap({ selectedRouteId, onSelectRoute }: RideMapProps) {
  const mapContainerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const selectRouteRef = useRef<(route: Route) => void>(() => {});
  const markersRef = useRef<Map<string, Marker>>(new Map());

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
