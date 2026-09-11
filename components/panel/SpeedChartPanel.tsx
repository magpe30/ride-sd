"use client";

import { useMemo, useRef, useState } from "react";

import { detectCorners, type Corner } from "@/lib/geo/corners";
import type { Pass } from "@/lib/gpx/passes";
import { buildSpeedChartSeries, mphAtMiles } from "@/lib/gpx/speedChart";
import type { LoadedRide } from "@/lib/gpx/session";

import FoldToggle from "./FoldToggle";

type SpeedChartPanelProps = {
  loadedRides: LoadedRide[];
  direction: Pass["direction"] | null;
  selectedCorner: Corner | null;
  onSelectCorner: (corner: Corner | null) => void;
};

const METERS_PER_MILE = 1609.344;
const CHART_WIDTH = 800;
const CHART_HEIGHT = 190;
const PADDING = { top: 12, right: 12, bottom: 22, left: 32 };
const PLOT_WIDTH = CHART_WIDTH - PADDING.left - PADDING.right;
const PLOT_HEIGHT = CHART_HEIGHT - PADDING.top - PADDING.bottom;

export default function SpeedChartPanel({
  loadedRides,
  direction,
  selectedCorner,
  onSelectCorner,
}: SpeedChartPanelProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [hoverMiles, setHoverMiles] = useState<number | null>(null);
  const [collapsed, setCollapsed] = useState(false);

  const activeRoute = loadedRides[0]?.ride.route ?? null;

  const series = useMemo(
    () => (direction ? buildSpeedChartSeries(loadedRides, direction) : []),
    [loadedRides, direction]
  );

  const corners = useMemo(
    () => (activeRoute ? detectCorners(activeRoute.line.coordinates) : []),
    [activeRoute]
  );

  if (!activeRoute || series.length === 0) return null;

  const cornerRanges = corners.map((corner) => ({
    corner,
    startMiles: corner.startArcLengthMeters / METERS_PER_MILE,
    endMiles: corner.endArcLengthMeters / METERS_PER_MILE,
  }));

  const maxMiles = Math.max(0.1, ...series.flatMap((s) => s.points.map((p) => p.miles)));
  const maxMphRaw = Math.max(10, ...series.flatMap((s) => s.points.map((p) => p.mph)));
  const yMax = Math.ceil((maxMphRaw * 1.1) / 10) * 10;

  const xScale = (miles: number) => PADDING.left + (miles / maxMiles) * PLOT_WIDTH;
  const yScale = (mph: number) => PADDING.top + PLOT_HEIGHT - (mph / yMax) * PLOT_HEIGHT;

  const linePath = (points: { miles: number; mph: number }[]) =>
    points
      .map((p, i) => `${i === 0 ? "M" : "L"} ${xScale(p.miles).toFixed(1)} ${yScale(p.mph).toFixed(1)}`)
      .join(" ");

  const milesFromPointer = (event: { clientX: number }): number | null => {
    const svg = svgRef.current;
    if (!svg) return null;
    const rect = svg.getBoundingClientRect();
    if (rect.width === 0) return null;
    const xInViewBox = ((event.clientX - rect.left) / rect.width) * CHART_WIDTH;
    const fraction = (xInViewBox - PADDING.left) / PLOT_WIDTH;
    return Math.max(0, Math.min(maxMiles, fraction * maxMiles));
  };

  const cornerAt = (miles: number) =>
    cornerRanges.find((c) => miles >= c.startMiles && miles <= c.endMiles);

  const yTicks = [0, yMax * 0.25, yMax * 0.5, yMax * 0.75, yMax];
  const hoveredCorner = hoverMiles !== null ? cornerAt(hoverMiles) : undefined;

  return (
    <div className={`speed-chart-panel${collapsed ? " speed-chart-panel--collapsed" : ""}`}>
      <div className="speed-chart-header">
        <span className="speed-chart-header-main">SPEED PROFILE</span>
        <div className="speed-chart-header-right">
          <div className="speed-chart-legend">
            {loadedRides.map((loaded) => (
              <span key={loaded.id} className="speed-chart-legend-item">
                <span className="speed-chart-legend-swatch" style={{ background: loaded.color }} />
                {loaded.label}
              </span>
            ))}
          </div>
          <FoldToggle
            collapsed={collapsed}
            onToggle={() => setCollapsed((c) => !c)}
            panelLabel="speed profile"
          />
        </div>
      </div>

      <div className={`panel-fold-region${collapsed ? " panel-fold-region--collapsed" : ""}`}>
        <div className="panel-fold-region-inner">
          <svg
            ref={svgRef}
            className="speed-chart-svg"
            viewBox={`0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`}
            preserveAspectRatio="none"
            onPointerMove={(event) => setHoverMiles(milesFromPointer(event))}
            onPointerLeave={() => setHoverMiles(null)}
            onClick={(event) => {
              // Computed fresh from the event rather than read from
              // `hoverMiles` state — on a fast move+click (as a real
              // trackpad tap, or Playwright's synthetic mouse.click, can
              // both produce), the click can fire before React has
              // committed the pointermove's state update, making the
              // closure's `hoverMiles` one step stale.
              const miles = milesFromPointer(event);
              if (miles === null) return;
              const found = cornerAt(miles);
              onSelectCorner(found ? found.corner : null);
            }}
          >
            {yTicks.map((tick) => (
              <g key={tick}>
                <line
                  x1={PADDING.left}
                  x2={CHART_WIDTH - PADDING.right}
                  y1={yScale(tick)}
                  y2={yScale(tick)}
                  className="speed-chart-gridline"
                />
                <text
                  x={PADDING.left - 6}
                  y={yScale(tick) + 3}
                  textAnchor="end"
                  className="speed-chart-axis-label"
                >
                  {Math.round(tick)}
                </text>
              </g>
            ))}

            {cornerRanges.map(({ corner, startMiles }) => (
              <line
                key={corner.index}
                x1={xScale(startMiles)}
                x2={xScale(startMiles)}
                y1={PADDING.top}
                y2={CHART_HEIGHT - PADDING.bottom}
                className={`speed-chart-corner-tick${
                  selectedCorner?.index === corner.index ? " speed-chart-corner-tick--selected" : ""
                }`}
              />
            ))}

            {series.map((s) => (
              <path
                key={s.rideId}
                d={linePath(s.points)}
                className="speed-chart-line"
                style={{ stroke: s.color }}
              />
            ))}

            {hoverMiles !== null && (
              <line
                x1={xScale(hoverMiles)}
                x2={xScale(hoverMiles)}
                y1={PADDING.top}
                y2={CHART_HEIGHT - PADDING.bottom}
                className="speed-chart-crosshair"
              />
            )}

            <text
              x={CHART_WIDTH - PADDING.right}
              y={CHART_HEIGHT - 5}
              textAnchor="end"
              className="speed-chart-axis-label"
            >
              {maxMiles.toFixed(1)} mi
            </text>
          </svg>

          <div className="speed-chart-readout">
            {hoverMiles !== null ? (
              <>
                <span className="speed-chart-readout-position">
                  {hoverMiles.toFixed(2)} mi
                  {hoveredCorner ? ` — corner #${hoveredCorner.corner.index} (click to inspect)` : ""}
                </span>
                {series.map((s) => {
                  const mph = mphAtMiles(s.points, hoverMiles);
                  return (
                    <span key={s.rideId} className="speed-chart-readout-item">
                      <span className="speed-chart-readout-dot" style={{ background: s.color }} />
                      {mph !== null ? `${mph.toFixed(1)} mph` : "—"}
                    </span>
                  );
                })}
              </>
            ) : (
              <span className="speed-chart-readout-position">
                Hover to read speed · click a point to inspect that corner
              </span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
