import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import CornerPanel from "@/components/panel/CornerPanel";
import { buildComparisonRides } from "@/lib/gpx/comparison";

import { makePass, makeRide, testCorner } from "./fixtures";

function renderPanel(
  rides: ReturnType<typeof makeRide>[],
  options: { direction?: "forward" | "reverse"; selected?: boolean } = {}
) {
  const direction = options.direction ?? "forward";
  const comparisonRides = buildComparisonRides(rides, direction);
  return render(
    <CornerPanel
      loadedRides={comparisonRides}
      selectedCorner={options.selected ? testCorner : null}
      onSelectCorner={vi.fn()}
      directions={[direction]}
      direction={direction}
      onChangeDirection={vi.fn()}
    />
  );
}

describe("CornerPanel modes", () => {
  it("keeps the current single-pass panel", () => {
    renderPanel([makeRide("only", [makePass({ startTimeMs: 1000 })])]);

    expect(screen.getByText("CORNERS")).toBeDefined();
    expect(screen.queryByText("CORNER COMPARISON")).toBeNull();
  });

  it("switches to A/B comparison for two passes from one file", () => {
    renderPanel([
      makeRide("recording", [
        makePass({ startTimeMs: 1000, minSpeedMps: 10 }),
        makePass({ startTimeMs: 2000, minSpeedMps: 11 }),
      ]),
    ]);

    expect(screen.getByText("CORNER COMPARISON")).toBeDefined();
    expect(screen.getByLabelText("Comparison order").textContent).toContain("ABASELINE");
    expect(screen.getByLabelText("Comparison order").textContent).toContain("BLATER");
    expect(screen.getAllByText("+2.2").length).toBeGreaterThan(0);
  });

  it("shows A/B/C values and deltas from A in selected-corner detail", () => {
    renderPanel(
      [
        makeRide("oldest", [makePass({ startTimeMs: 1000, minSpeedMps: 10 })]),
        makeRide("later", [makePass({ startTimeMs: 2000, minSpeedMps: 11 })]),
        makeRide("latest", [makePass({ startTimeMs: 3000, minSpeedMps: 12 })]),
      ],
      { selected: true }
    );

    expect(screen.getByLabelText("Comparison order").textContent).toContain("CLATEST");
    expect(screen.getAllByText("+2.2").length).toBeGreaterThan(0);
    expect(screen.getAllByText("+4.5").length).toBeGreaterThan(0);
  });

  it("uses blanks when a comparison pass lacks corner coverage", () => {
    renderPanel(
      [
        makeRide("baseline", [makePass({ startTimeMs: 1000 })]),
        makeRide("missing", [makePass({ startTimeMs: 2000, withMetrics: false })]),
      ],
      { selected: true }
    );

    expect(screen.getAllByText("Δ —").length).toBeGreaterThan(0);
  });

  it("shows the opposite turn label for reverse travel", () => {
    renderPanel(
      [makeRide("reverse", [makePass({ startTimeMs: 1000, direction: "reverse" })])],
      { direction: "reverse", selected: true }
    );

    const reverseTurn = testCorner.direction === "left" ? "RIGHT" : "LEFT";
    expect(
      screen.getByText(new RegExp(`CORNER #${testCorner.index} — ${reverseTurn}`))
    ).toBeDefined();
  });
});
