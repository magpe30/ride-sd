"use client";

import { useMemo, useState, type CSSProperties } from "react";

import { detectCorners, type Corner } from "@/lib/geo/corners";
import { buildCornerComparison } from "@/lib/gpx/compareCorners";
import {
  comparisonCornerSummary,
  singleCornerSummary,
} from "@/lib/gpx/cornerSummary";
import {
  displayTurnDirection,
  type ComparisonRide,
  type ComparisonSlot,
} from "@/lib/gpx/comparison";
import type { CornerMetrics } from "@/lib/gpx/cornerMetrics";
import type { Pass } from "@/lib/gpx/passes";

import FoldToggle from "./FoldToggle";

type CornerPanelProps = {
  loadedRides: ComparisonRide[];
  selectedCorner: Corner | null;
  onSelectCorner: (corner: Corner | null) => void;
  directions: Pass["direction"][];
  direction: Pass["direction"] | null;
  onChangeDirection: (direction: Pass["direction"]) => void;
};

type SpeedMetricKey =
  | "approachSpeedMps"
  | "minSpeedMps"
  | "medianSpeedMps"
  | "maxSpeedMps"
  | "exitSpeedMps"
  | "speedLostMps"
  | "speedGainedMps";

type MetricDefinition =
  | { label: string; key: SpeedMetricKey; kind: "speed" }
  | { label: string; key: "estimatedLeanAngleDegrees"; kind: "angle" };

const MPS_TO_MPH = 2.23694;

const PRIMARY_METRICS: MetricDefinition[] = [
  { label: "APPROACH", key: "approachSpeedMps", kind: "speed" },
  { label: "MINIMUM", key: "minSpeedMps", kind: "speed" },
  { label: "EXIT", key: "exitSpeedMps", kind: "speed" },
];

const MORE_METRICS: MetricDefinition[] = [
  { label: "MEDIAN", key: "medianSpeedMps", kind: "speed" },
  { label: "MAX", key: "maxSpeedMps", kind: "speed" },
  { label: "LOST", key: "speedLostMps", kind: "speed" },
  { label: "GAINED", key: "speedGainedMps", kind: "speed" },
  { label: "LEAN", key: "estimatedLeanAngleDegrees", kind: "angle" },
];

const SINGLE_METRICS: MetricDefinition[] = [
  { label: "APPROACH", key: "approachSpeedMps", kind: "speed" },
  { label: "MIN", key: "minSpeedMps", kind: "speed" },
  { label: "MEDIAN", key: "medianSpeedMps", kind: "speed" },
  { label: "MAX", key: "maxSpeedMps", kind: "speed" },
  { label: "EXIT", key: "exitSpeedMps", kind: "speed" },
  { label: "LOST", key: "speedLostMps", kind: "speed" },
  { label: "GAINED", key: "speedGainedMps", kind: "speed" },
  { label: "LEAN", key: "estimatedLeanAngleDegrees", kind: "angle" },
];

function mph(mps: number): string {
  return (mps * MPS_TO_MPH).toFixed(1);
}

function formatMetric(
  metrics: CornerMetrics,
  metric: MetricDefinition,
  includeSpeedUnit = false
): string {
  const value = metrics[metric.key];
  if (metric.kind === "angle") return `~${value.toFixed(0)}°`;
  return `${mph(value)}${includeSpeedUnit ? " mph" : ""}`;
}

function formatDelta(
  metrics: CornerMetrics | undefined,
  baseline: CornerMetrics | undefined,
  metric: MetricDefinition
): string | null {
  if (!metrics || !baseline) return null;
  const difference = metrics[metric.key] - baseline[metric.key];
  const converted = metric.kind === "speed" ? difference * MPS_TO_MPH : difference;
  const suffix = metric.kind === "speed" ? "" : "°";
  return `${converted > 0 ? "+" : ""}${converted.toFixed(1)}${suffix}`;
}

function slotDescription(slot: ComparisonSlot): string {
  if (slot === "A") return "BASELINE";
  if (slot === "C") return "LATEST";
  return "LATER";
}

export default function CornerPanel({
  loadedRides,
  selectedCorner,
  onSelectCorner,
  directions,
  direction,
  onChangeDirection,
}: CornerPanelProps) {
  const [collapsed, setCollapsed] = useState(false);
  const activeRoute = loadedRides[0]?.ride.route ?? null;

  const corners = useMemo(
    () => (activeRoute ? detectCorners(activeRoute.line.coordinates) : []),
    [activeRoute]
  );

  const activeDirection = direction && directions.includes(direction) ? direction : directions[0];

  const rows = useMemo(() => {
    if (!activeDirection) return [];
    const comparisonRows = buildCornerComparison(loadedRides, corners, activeDirection);
    return activeDirection === "reverse" ? comparisonRows.reverse() : comparisonRows;
  }, [loadedRides, corners, activeDirection]);

  if (!activeRoute || loadedRides.length === 0) return null;

  const comparisonMode = loadedRides.length > 1;
  const selectedRow = selectedCorner
    ? rows.find((row) => row.corner.index === selectedCorner.index)
    : undefined;
  const selectedBaseline = selectedRow?.entries.find(
    (entry) => entry.rideId === loadedRides[0].id
  )?.metrics;

  const renderComparisonMetrics = (
    metrics: MetricDefinition[],
    detailClassName = ""
  ) => {
    if (!selectedRow) return null;
    const baseline = selectedRow.entries.find(
      (entry) => entry.rideId === loadedRides[0].id
    )?.metrics;

    return (
      <div
        className={`corner-comparison-metrics ${detailClassName}`.trim()}
        style={{ "--comparison-count": loadedRides.length } as CSSProperties}
      >
        <div className="corner-comparison-metric-row corner-comparison-metric-row--header">
          <span />
          {loadedRides.map((ride) => (
            <span key={ride.id} style={{ color: ride.color }}>
              {ride.comparison.slot}
            </span>
          ))}
        </div>
        {metrics.map((metric) => (
          <div key={metric.key} className="corner-comparison-metric-row">
            <span className="corner-comparison-metric-label">{metric.label}</span>
            {loadedRides.map((ride) => {
              const current = selectedRow.entries.find(
                (entry) => entry.rideId === ride.id
              )?.metrics;
              const delta =
                ride.comparison.slot === "A"
                  ? null
                  : formatDelta(current, baseline, metric);

              return (
                <span key={ride.id} className="corner-comparison-metric-value">
                  <strong>{current ? formatMetric(current, metric) : "—"}</strong>
                  {ride.comparison.slot === "A" ? (
                    <small>BASE</small>
                  ) : (
                    <small>{delta ?? "Δ —"}</small>
                  )}
                </span>
              );
            })}
          </div>
        ))}
      </div>
    );
  };

  return (
    <div className={`corner-panel${collapsed ? " corner-panel--collapsed" : ""}`}>
      <div className="corner-panel-header">
        <span className="corner-panel-header-main">
          {comparisonMode ? "CORNER COMPARISON" : "CORNERS"}
        </span>
        <div className="corner-panel-header-right">
          <span className="corner-panel-header-count">{rows.length} LOADED</span>
          <FoldToggle
            collapsed={collapsed}
            onToggle={() => setCollapsed((current) => !current)}
            panelLabel="corners panel"
          />
        </div>
      </div>

      <div className={`panel-fold-region${collapsed ? " panel-fold-region--collapsed" : ""}`}>
        <div className="panel-fold-region-inner">
          {directions.length > 1 ? (
            <div className="corner-panel-tabs">
              {directions.map((candidateDirection) => (
                <button
                  key={candidateDirection}
                  type="button"
                  className={`corner-panel-tab${
                    candidateDirection === activeDirection ? " corner-panel-tab--active" : ""
                  }`}
                  onClick={() => {
                    onChangeDirection(candidateDirection);
                    onSelectCorner(null);
                  }}
                >
                  {activeRoute.directionLabels[candidateDirection]}
                </button>
              ))}
            </div>
          ) : (
            <div className="corner-panel-direction-static">
              {activeDirection ? activeRoute.directionLabels[activeDirection] : null}
            </div>
          )}

          {comparisonMode ? (
            <div
              className="corner-comparison-key"
              aria-label="Comparison order"
              style={{ "--comparison-count": loadedRides.length } as CSSProperties}
            >
              {loadedRides.map((ride) => (
                <span key={ride.id} title={ride.label}>
                  <i style={{ background: ride.color }} />
                  <strong>{ride.comparison.slot}</strong>
                  {slotDescription(ride.comparison.slot)}
                </span>
              ))}
            </div>
          ) : (
            <div className="corner-panel-legend">
              Min speed per ride (mph) · tap a corner for the full breakdown
            </div>
          )}

          {selectedRow && (
            <div className="corner-panel-detail">
              <div className="corner-panel-detail-title">
                CORNER #{selectedRow.corner.index} —{" "}
                {activeDirection
                  ? displayTurnDirection(
                      activeDirection,
                      selectedRow.corner.direction
                    ).toUpperCase()
                  : selectedRow.corner.direction.toUpperCase()} —{" "}
                {selectedRow.corner.turnAngleDegrees.toFixed(0)}° —{" "}
                {selectedRow.corner.endArcLengthMeters -
                  selectedRow.corner.startArcLengthMeters <
                1000
                  ? `${(
                      selectedRow.corner.endArcLengthMeters -
                      selectedRow.corner.startArcLengthMeters
                    ).toFixed(0)}m`
                  : `${(
                      (selectedRow.corner.endArcLengthMeters -
                        selectedRow.corner.startArcLengthMeters) /
                      1000
                    ).toFixed(1)}km`}
              </div>

              <div className="corner-performance-summary" aria-label="Corner performance summary">
                <span className="corner-performance-summary-label">SUMMARY</span>
                {comparisonMode ? (
                  loadedRides.slice(1).map((ride) => {
                    const current = selectedRow.entries.find(
                      (entry) => entry.rideId === ride.id
                    )?.metrics;
                    return (
                      <p key={ride.id}>
                        <i style={{ background: ride.color }} />
                        {comparisonCornerSummary(
                          ride.comparison.slot,
                          current,
                          selectedBaseline
                        )}
                      </p>
                    );
                  })
                ) : selectedBaseline ? (
                  <p>
                    <i style={{ background: loadedRides[0].color }} />
                    {singleCornerSummary(selectedBaseline)}
                  </p>
                ) : null}
              </div>

              {comparisonMode ? (
                <>
                  {renderComparisonMetrics(PRIMARY_METRICS)}
                  <details className="corner-comparison-more">
                    <summary>More measurements</summary>
                    {renderComparisonMetrics(MORE_METRICS, "corner-comparison-metrics--more")}
                    <p>Lean is estimated from GPS speed and road-centerline radius.</p>
                  </details>
                </>
              ) : (
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
                  {SINGLE_METRICS.map((metric) => (
                    <div key={metric.key} className="corner-panel-detail-row">
                      <span className="corner-panel-detail-label">{metric.label}</span>
                      {loadedRides.map((loaded) => {
                        const entry = selectedRow.entries.find(
                          (candidate) => candidate.rideId === loaded.id
                        );
                        return (
                          <span key={loaded.id} className="corner-panel-detail-value">
                            {entry ? formatMetric(entry.metrics, metric, true) : "—"}
                          </span>
                        );
                      })}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          <div className="corner-panel-list">
            {rows.map((row) => {
              const isSelected = selectedCorner?.index === row.corner.index;
              const turnDirection = activeDirection
                ? displayTurnDirection(activeDirection, row.corner.direction)
                : row.corner.direction;
              const turnGlyph = turnDirection === "left" ? "‹" : "›";
              const baselineMin = row.entries.find(
                (entry) => entry.rideId === loadedRides[0].id
              )?.metrics.minSpeedMps;

              return (
                <button
                  key={row.corner.index}
                  type="button"
                  aria-pressed={isSelected}
                  className={`corner-row${isSelected ? " corner-row--selected" : ""}${
                    comparisonMode ? " corner-row--comparison" : ""
                  }`}
                  onClick={() => onSelectCorner(isSelected ? null : row.corner)}
                >
                  <span className="corner-row-index">
                    {turnGlyph} #{row.corner.index}
                    <span className="corner-row-angle">
                      {row.corner.turnAngleDegrees.toFixed(0)}°
                    </span>
                  </span>

                  {comparisonMode ? (
                    <span
                      className="corner-row-comparison-values"
                      style={{ "--comparison-count": loadedRides.length } as CSSProperties}
                    >
                      {loadedRides.map((ride) => {
                        const minSpeed = row.entries.find(
                          (entry) => entry.rideId === ride.id
                        )?.metrics.minSpeedMps;
                        const delta =
                          ride.comparison.slot !== "A" &&
                          minSpeed !== undefined &&
                          baselineMin !== undefined
                            ? (minSpeed - baselineMin) * MPS_TO_MPH
                            : null;

                        return (
                          <span key={ride.id} className="corner-row-comparison-value">
                            <strong style={{ color: ride.color }}>
                              {ride.comparison.slot}
                            </strong>
                            <span>{minSpeed === undefined ? "—" : mph(minSpeed)}</span>
                            <small>
                              {ride.comparison.slot === "A"
                                ? "BASE"
                                : delta === null
                                  ? "Δ —"
                                  : `${delta > 0 ? "+" : ""}${delta.toFixed(1)}`}
                            </small>
                          </span>
                        );
                      })}
                    </span>
                  ) : (
                    <span className="corner-row-rides">
                      {loadedRides.map((loaded) => {
                        const entry = row.entries.find(
                          (candidate) => candidate.rideId === loaded.id
                        );
                        return (
                          <span key={loaded.id} className="corner-row-ride-chip">
                            <span
                              className="corner-row-ride-dot"
                              style={{ background: loaded.color }}
                            />
                            {entry ? mph(entry.metrics.minSpeedMps) : "—"}
                          </span>
                        );
                      })}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
