"use client";

import { useState } from "react";

import RideMap from "@/components/map/RideMap";
import RoutePanel from "@/components/panel/RoutePanel";
import { routes } from "@/data/routes";

export default function Home() {
  const [selectedRouteId, setSelectedRouteId] = useState<string | null>(null);

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
      <RideMap selectedRouteId={selectedRouteId} onSelectRoute={setSelectedRouteId} />
    </main>
  );
}
