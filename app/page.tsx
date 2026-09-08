"use client";

import { useState } from "react";

import RideMap from "@/components/map/RideMap";
import RoutePanel from "@/components/panel/RoutePanel";
import UploadPanel from "@/components/panel/UploadPanel";
import { routes } from "@/data/routes";
import type { LoadedRide } from "@/lib/gpx/session";

export default function Home() {
  const [selectedRouteId, setSelectedRouteId] = useState<string | null>(null);
  const [loadedRides, setLoadedRides] = useState<LoadedRide[]>([]);

  const handleAddRide = (loaded: LoadedRide) => {
    setLoadedRides((prev) => [...prev, loaded]);
    setSelectedRouteId(loaded.ride.route.id);
  };

  const handleRemoveRide = (id: string) => {
    setLoadedRides((prev) => prev.filter((loaded) => loaded.id !== id));
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
      <RideMap
        selectedRouteId={selectedRouteId}
        onSelectRoute={setSelectedRouteId}
        loadedRides={loadedRides}
      />
    </main>
  );
}
