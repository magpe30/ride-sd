"use client";

import { useState } from "react";

import type { Route } from "@/data/routes";

import FoldToggle from "./FoldToggle";

type RoutePanelProps = {
  routes: Route[];
  selectedRouteId: string | null;
  onSelectRoute: (id: string) => void;
};

export default function RoutePanel({
  routes,
  selectedRouteId,
  onSelectRoute,
}: RoutePanelProps) {
  const [collapsed, setCollapsed] = useState(false);

  return (
    <div className={`route-panel${collapsed ? " route-panel--collapsed" : ""}`}>
      <div className="route-panel-header">
        <span className="route-panel-header-main">ROUTES</span>
        <div className="route-panel-header-right">
          <span className="route-panel-header-count">{routes.length} LOADED</span>
          <FoldToggle
            collapsed={collapsed}
            onToggle={() => setCollapsed((c) => !c)}
            panelLabel="routes panel"
          />
        </div>
      </div>
      <div className={`panel-fold-region${collapsed ? " panel-fold-region--collapsed" : ""}`}>
        <div className="panel-fold-region-inner">
          <div className="route-panel-list">
            {routes.map((route) => {
              const isActive = route.id === selectedRouteId;

              return (
                <button
                  key={route.id}
                  className={`route-card${isActive ? " route-card--active" : ""}`}
                  onClick={() => onSelectRoute(route.id)}
                >
                  <div className="route-card-top">
                    <span className="route-card-name">{route.name}</span>
                    <span className="route-card-distance">{route.distanceMiles} MI</span>
                  </div>
                  <p className="route-card-description">{route.description}</p>
                  <div className="route-card-stats">
                    <span className="route-card-stat">{route.cornerCount} CORNERS</span>
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
