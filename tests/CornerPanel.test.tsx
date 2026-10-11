import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import CornerPanel from "@/components/panel/CornerPanel";
import { buildComparisonRides } from "@/lib/gpx/comparison";

import { makePass, makeRide, testCorner } from "./fixtures";

const playbackEngine = {
  hasPlayableRides: true,
  playing: false,
  finishedRideIds: new Set<string>(),
  allFinished: false,
  mode: "route" as const,
  togglePlay: vi.fn(),
  playCorner: vi.fn(),
  reset: vi.fn(),
  subscribe: vi.fn(() => () => {}),
  getStates: vi.fn(() => []),
};

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
      playbackEngine={playbackEngine}
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
    expect(screen.getByLabelText("Corner coaching summary").textContent).toContain(
      "PREPARATION"
    );
    expect(screen.getByLabelText("Minimum speed location comparison").textContent).toContain(
      "C50% through"
    );
    expect(screen.getAllByText("+2.2").length).toBeGreaterThan(0);
    expect(screen.getAllByText("+4.5").length).toBeGreaterThan(0);
  });

  it("starts a synchronized corner story from the selected corner", () => {
    playbackEngine.playCorner.mockClear();
    renderPanel(
      [
        makeRide("baseline", [makePass({ startTimeMs: 1000 })]),
        makeRide("latest", [makePass({ startTimeMs: 2000 })]),
      ],
      { selected: true }
    );

    screen.getByRole("button", { name: "REPLAY" }).click();

    expect(playbackEngine.playCorner).toHaveBeenCalledWith(testCorner);
  });

  it("separates coaching from raw corner metrics", () => {
    renderPanel(
      [makeRide("only", [makePass({ startTimeMs: 1000 })])],
      { selected: true }
    );

    const coachingTab = screen.getByRole("tab", { name: "COACHING" });
    const metricsTab = screen.getByRole("tab", { name: "METRICS" });
    expect(coachingTab.getAttribute("aria-selected")).toBe("true");
    expect(document.querySelector("#corner-metrics-panel")?.hasAttribute("hidden")).toBe(true);

    fireEvent.click(metricsTab);

    expect(metricsTab.getAttribute("aria-selected")).toBe("true");
    expect(document.querySelector("#corner-coaching-panel")?.hasAttribute("hidden")).toBe(true);
    expect(document.querySelector("#corner-metrics-panel")?.hasAttribute("hidden")).toBe(false);
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
