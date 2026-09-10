"use client";

import { useMemo, useState } from "react";

import RideMap from "@/components/map/RideMap";
import CornerPanel from "@/components/panel/CornerPanel";
import RoutePanel from "@/components/panel/RoutePanel";
import SpeedChartPanel from "@/components/panel/SpeedChartPanel";
import UploadPanel from "@/components/panel/UploadPanel";
import { routes } from "@/data/routes";
import type { Corner } from "@/lib/geo/corners";
import { availableDirections } from "@/lib/gpx/compareCorners";
import type { Pass } from "@/lib/gpx/passes";
import type { LoadedRide } from "@/lib/gpx/session";

export default function Home() {
  const [selectedRouteId, setSelectedRouteId] = useState<string | null>(null);
  const [loadedRides, setLoadedRides] = useState<LoadedRide[]>([]);
  const [selectedCorner, setSelectedCorner] = useState<Corner | null>(null);
  const [direction, setDirection] = useState<Pass["direction"] | null>(null);

  const directions = useMemo(() => availableDirections(loadedRides), [loadedRides]);
  const activeDirection = direction && directions.includes(direction) ? direction : (directions[0] ?? null);

  const handleAddRide = (loaded: LoadedRide) => {
    setLoadedRides((prev) => [...prev, loaded]);
    setSelectedRouteId(loaded.ride.route.id);
  };

  const handleRemoveRide = (id: string) => {
    setLoadedRides((prev) => prev.filter((loaded) => loaded.id !== id));
    setSelectedCorner(null);
  };

  const handleChangeDirection = (next: Pass["direction"]) => {
    setDirection(next);
    setSelectedCorner(null);
  };

  return (
    <main>
      <div className="hud-title-chip">
        <span className="hud-title-main">RIDE SD</span>
        <span className="hud-title-sub">SAN DIEGO COUNTY</span>
      </div>
      <RoutePanel
        routes={routes}
        selectedRouteId={selectedRouteId}
        onSelectRoute={setSelectedRouteId}
      />
      <UploadPanel
        loadedRides={loadedRides}
        onAddRide={handleAddRide}
        onRemoveRide={handleRemoveRide}
      />
      <CornerPanel
        loadedRides={loadedRides}
        selectedCorner={selectedCorner}
        onSelectCorner={setSelectedCorner}
        directions={directions}
        direction={activeDirection}
        onChangeDirection={handleChangeDirection}
      />
      <SpeedChartPanel
        loadedRides={loadedRides}
        direction={activeDirection}
        selectedCorner={selectedCorner}
        onSelectCorner={setSelectedCorner}
      />
      <RideMap
        selectedRouteId={selectedRouteId}
        onSelectRoute={setSelectedRouteId}
        loadedRides={loadedRides}
        selectedCorner={selectedCorner}
      />
    </main>
  );
}
