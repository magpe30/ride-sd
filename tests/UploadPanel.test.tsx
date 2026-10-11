import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";

import UploadPanel from "@/components/panel/UploadPanel";
import { routes } from "@/data/routes";
import type { LoadedRide } from "@/lib/gpx/session";

import { makePass, makeRide } from "./fixtures";

vi.mock("@/lib/gpx/parse", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/gpx/parse")>();
  return {
    ...original,
    parseGpx: vi.fn(() => []),
  };
});

vi.mock("@/lib/gpx/analyzeRide", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/gpx/analyzeRide")>();
  return {
    ...original,
    analyzeRide: vi.fn(() => ({
      ok: true,
      ride: {
        route: routes[2],
        passes: [makePass({ startTimeMs: 2000 })],
      },
    })),
  };
});

function UploadHarness({ initialRide }: { initialRide: LoadedRide }) {
  const [rides, setRides] = useState([initialRide]);

  return (
    <UploadPanel
      loadedRides={rides}
      onAddRide={(ride) => setRides((current) => [...current, ride])}
      onRemoveRide={(id) => setRides((current) => current.filter((ride) => ride.id !== id))}
    />
  );
}

function EmptyUploadHarness() {
  const [rides, setRides] = useState<LoadedRide[]>([]);

  return (
    <UploadPanel
      loadedRides={rides}
      onAddRide={(ride) => setRides((current) => [...current, ride])}
      onRemoveRide={(id) => setRides((current) => current.filter((ride) => ride.id !== id))}
    />
  );
}

function gpxFile(name: string): File {
  return {
    name,
    size: 1024,
    text: async () => "gpx",
  } as File;
}

describe("UploadPanel errors", () => {
  it("clears a route mismatch after a loaded ride is removed", async () => {
    const initialRide = makeRide("palomar", [makePass({ startTimeMs: 1000 })]);
    const { container } = render(<UploadHarness initialRide={initialRide} />);
    const input = container.querySelector<HTMLInputElement>('input[type="file"]');
    const mismatchedFile = {
      name: "montezuma.gpx",
      text: async () => "gpx",
    } as File;

    expect(input).not.toBeNull();
    fireEvent.change(input!, { target: { files: [mismatchedFile] } });

    expect(await screen.findByText(/current comparison contains/i)).toBeDefined();

    fireEvent.click(screen.getByRole("button", { name: "Remove ride" }));

    await waitFor(() => {
      expect(screen.queryByText(/current comparison contains/i)).toBeNull();
    });
    expect(screen.getByRole("button", { name: "UPLOAD GPX (0/3)" })).toBeDefined();
  });

  it("loads up to three selected GPX files in one batch", async () => {
    const { container } = render(<EmptyUploadHarness />);
    const input = container.querySelector<HTMLInputElement>('input[type="file"]');
    const files = [gpxFile("one.gpx"), gpxFile("two.gpx"), gpxFile("three.gpx")];

    expect(input?.multiple).toBe(true);
    fireEvent.change(input!, { target: { files } });

    expect(await screen.findByText("Added 3 rides — ready to compare.")).toBeDefined();
    expect(screen.getAllByRole("button", { name: "Remove ride" })).toHaveLength(3);
    expect(screen.getByRole("button", { name: "3/3 RIDES LOADED" })).toBeDefined();
  });

  it("rejects a batch that exceeds the remaining ride slots", async () => {
    const initialRide = makeRide("palomar", [makePass({ startTimeMs: 1000 })]);
    const { container } = render(<UploadHarness initialRide={initialRide} />);
    const input = container.querySelector<HTMLInputElement>('input[type="file"]');

    fireEvent.change(input!, {
      target: {
        files: [gpxFile("one.gpx"), gpxFile("two.gpx"), gpxFile("three.gpx")],
      },
    });

    expect(await screen.findByText(/choose up to 2 more rides/i)).toBeDefined();
    expect(screen.getAllByRole("button", { name: "Remove ride" })).toHaveLength(1);
  });
});
