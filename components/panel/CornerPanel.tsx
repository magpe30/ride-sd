"use client";

import { useMemo, useState, type CSSProperties } from "react";

import { detectCorners, type Corner } from "@/lib/geo/corners";
import {
  availableDirections,
  buildCornerComparison,
  fastestRideId,
} from "@/lib/gpx/compareCorners";
import type { Pass } from "@/lib/gpx/passes";
import type { LoadedRide } from "@/lib/gpx/session";

type CornerPanelProps = {
  loadedRides: LoadedRide[];
  selectedCorner: Corner | null;
  onSelectCorner: (corner: Corner | null) => void;
};

const MPS_TO_MPH = 2.23694;

function mph(mps: number): string {
  return (mps * MPS_TO_MPH).toFixed(1);
}

const METRIC_ROWS: Array<{
  label: string;
  value: (m: { approachSpeedMps: number; minSpeedMps: number; medianSpeedMps: number; maxSpeedMps: number; exitSpeedMps: number; speedLostMps: number; speedGainedMps: number; estimatedLeanAngleDegrees: number }) => string;
}> = [
  { label: "APPROACH", value: (m) => `${mph(m.approachSpeedMps)} mph` },
  { label: "MIN", value: (m) => `${mph(m.minSpeedMps)} mph` },
  { label: "MEDIAN", value: (m) => `${mph(m.medianSpeedMps)} mph` },
  { label: "MAX", value: (m) => `${mph(m.maxSpeedMps)} mph` },
  { label: "EXIT", value: (m) => `${mph(m.exitSpeedMps)} mph` },
  { label: "LOST", value: (m) => `${mph(m.speedLostMps)} mph` },
  { label: "GAINED", value: (m) => `${mph(m.speedGainedMps)} mph` },
  { label: "LEAN~", value: (m) => `${m.estimatedLeanAngleDegrees.toFixed(0)}°` },
];

export default function CornerPanel({ loadedRides, selectedCorner, onSelectCorner }: CornerPanelProps) {
  const activeRoute = loadedRides[0]?.ride.route ?? null;

  const corners = useMemo(
    () => (activeRoute ? detectCorners(activeRoute.line.coordinates) : []),
    [activeRoute]
  );

  const directions = useMemo(() => availableDirections(loadedRides), [loadedRides]);
  const [direction, setDirection] = useState<Pass["direction"]>("forward");
  const activeDirection = directions.includes(direction) ? direction : directions[0];

  const rows = useMemo(
    () =>
      activeDirection
        ? buildCornerComparison(loadedRides, corners, activeDirection)
        : [],
    [loadedRides, corners, activeDirection]
  );

  if (!activeRoute || loadedRides.length === 0) return null;

  const selectedRow = selectedCorner
    ? rows.find((row) => row.corner.index === selectedCorner.index)
    : undefined;

  return (
    <div className="corner-panel">
      <div className="corner-panel-header">
        <span className="corner-panel-header-main">CORNERS</span>
        <span className="corner-panel-header-count">{rows.length} LOADED</span>
      </div>

      {directions.length > 1 ? (
        <div className="corner-panel-tabs">
          {directions.map((d) => (
            <button
              key={d}
              className={`corner-panel-tab${d === activeDirection ? " corner-panel-tab--active" : ""}`}
              onClick={() => {
                setDirection(d);
                onSelectCorner(null);
              }}
            >
              {activeRoute.directionLabels[d]}
            </button>
          ))}
        </div>
      ) : (
        <div className="corner-panel-direction-static">
          {activeDirection ? activeRoute.directionLabels[activeDirection] : null}
        </div>
      )}

      <div className="corner-panel-legend">
        Min speed per ride (mph) · tap a corner for the full breakdown
      </div>

      {selectedRow && (
        <div className="corner-panel-detail">
          <div className="corner-panel-detail-title">
            CORNER #{selectedRow.corner.index} — {selectedRow.corner.direction.toUpperCase()} —{" "}
            {selectedRow.corner.turnAngleDegrees.toFixed(0)}° — {selectedRow.corner.endArcLengthMeters - selectedRow.corner.startArcLengthMeters < 1000
              ? `${(selectedRow.corner.endArcLengthMeters - selectedRow.corner.startArcLengthMeters).toFixed(0)}m`
              : `${((selectedRow.corner.endArcLengthMeters - selectedRow.corner.startArcLengthMeters) / 1000).toFixed(1)}km`}
          </div>
          <div className="corner-panel-detail-grid">
            <div className="corner-panel-detail-row corner-panel-detail-row--header">
              <span className="corner-panel-detail-label" />
              {loadedRides.map((loaded) => (
                <span
                  key={loaded.id}
                  className="corner-panel-detail-swatch"
                  style={{ "--ride-color": loaded.color } as CSSProperties}
                />
              ))}
            </div>
            {METRIC_ROWS.map(({ label, value }) => (
              <div key={label} className="corner-panel-detail-row">
                <span className="corner-panel-detail-label">{label}</span>
                {loadedRides.map((loaded) => {
                  const entry = selectedRow.entries.find((e) => e.rideId === loaded.id);
                  return (
                    <span key={loaded.id} className="corner-panel-detail-value">
                      {entry ? value(entry.metrics) : "—"}
                    </span>
                  );
                })}
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="corner-panel-list">
        {rows.map((row) => {
          const isSelected = selectedCorner?.index === row.corner.index;
          const fastest = fastestRideId(row.entries);
          const turnGlyph = row.corner.direction === "left" ? "‹" : "›";

          return (
            <button
              key={row.corner.index}
              className={`corner-row${isSelected ? " corner-row--selected" : ""}`}
              onClick={() => onSelectCorner(isSelected ? null : row.corner)}
            >
              <span className="corner-row-index">
                {turnGlyph} #{row.corner.index}
                <span className="corner-row-angle">{row.corner.turnAngleDegrees.toFixed(0)}°</span>
              </span>
              <span className="corner-row-rides">
                {loadedRides.map((loaded) => {
                  const entry = row.entries.find((e) => e.rideId === loaded.id);
                  const isFastest = entry && entry.rideId === fastest;
                  return (
                    <span
                      key={loaded.id}
                      className={`corner-row-ride-chip${isFastest ? " corner-row-ride-chip--fastest" : ""}`}
                    >
                      <span className="corner-row-ride-dot" style={{ background: loaded.color }} />
                      {entry ? `${mph(entry.metrics.minSpeedMps)}` : "—"}
                    </span>
                  );
                })}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
