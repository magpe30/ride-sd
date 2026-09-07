"use client";

import type { Route } from "@/data/routes";

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
  return (
    <div className="route-panel">
      <div className="route-panel-header">
        <span className="route-panel-header-main">ROUTES</span>
        <span className="route-panel-header-count">{routes.length} LOADED</span>
      </div>
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
  );
}
