"use client";

import { useRef, useState } from "react";

import { routes } from "@/data/routes";
import { analyzeRide, type AnalyzedRide, type RideAnalysisResult } from "@/lib/gpx/analyzeRide";
import { validateComparisonRoute } from "@/lib/gpx/comparison";
import { parseGpx, validateGpxFile } from "@/lib/gpx/parse";
import {
  createLoadedRide,
  deriveRideLabel,
  MAX_LOADED_RIDES,
  type LoadedRide,
} from "@/lib/gpx/session";

type UploadPanelProps = {
  loadedRides: LoadedRide[];
  onAddRide: (ride: LoadedRide) => void;
  onRemoveRide: (id: string) => void;
};

type Status = "idle" | "processing" | "error" | "done";

function summarizeRide(ride: AnalyzedRide): string {
  const totalCorners = ride.passes.reduce((sum, p) => sum + p.cornerMetrics.length, 0);
  const passWord = ride.passes.length === 1 ? "pass" : "passes";
  return `${ride.passes.length} ${passWord}, ${totalCorners} corner readings`;
}

function analysisErrorMessage(result: Extract<RideAnalysisResult, { ok: false }>): string {
  switch (result.reason) {
    case "ambiguous-route":
      return "This GPX overlaps more than one supported route, so it was not added.";
    case "no-usable-pass":
      return "The route matched, but no continuous pass of at least 150 m was found.";
    default:
      return "No confident match — this GPX does not overlap enough of a supported route.";
  }
}

export default function UploadPanel({ loadedRides, onAddRide, onRemoveRide }: UploadPanelProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [status, setStatus] = useState<Status>("idle");
  const [message, setMessage] = useState<string | null>(null);

  const atCapacity = loadedRides.length >= MAX_LOADED_RIDES;

  const handleRemoveRide = (id: string) => {
    setStatus("idle");
    setMessage(null);
    onRemoveRide(id);
  };

  const handleFiles = async (files: readonly File[]) => {
    if (atCapacity) {
      setStatus("error");
      setMessage(`Already comparing ${MAX_LOADED_RIDES} rides — remove one to add another.`);
      return;
    }

    const availableSlots = MAX_LOADED_RIDES - loadedRides.length;
    if (files.length > availableSlots) {
      setStatus("error");
      setMessage(
        `Choose up to ${availableSlots} more ${availableSlots === 1 ? "ride" : "rides"}. The comparison supports ${MAX_LOADED_RIDES} total.`
      );
      return;
    }

    setStatus("processing");
    setMessage(null);

    const pendingRides = [...loadedRides];
    const addedRides: LoadedRide[] = [];
    const errors: string[] = [];

    for (const file of files) {
      try {
        validateGpxFile(file);
        const text = await file.text();
        const track = parseGpx(text);
        const result = analyzeRide(track, routes);

        if (!result.ok) throw new Error(analysisErrorMessage(result));

        const analyzed = result.ride;
        const routeValidation = validateComparisonRoute(analyzed, pendingRides);
        if (!routeValidation.ok) throw new Error(routeValidation.message);

        const loaded = createLoadedRide(
          analyzed,
          pendingRides,
          deriveRideLabel(file.name)
        );
        pendingRides.push(loaded);
        addedRides.push(loaded);
      } catch (error) {
        errors.push(
          `${file.name}: ${error instanceof Error ? error.message : "Failed to parse GPX file."}`
        );
      }
    }

    for (const ride of addedRides) onAddRide(ride);

    if (errors.length > 0) {
      setStatus("error");
      const addedPrefix = addedRides.length > 0
        ? `Added ${addedRides.length} of ${files.length}. `
        : "";
      setMessage(`${addedPrefix}${errors.join(" ")}`);
      return;
    }

    setStatus("done");
    if (addedRides.length === 1) {
      setMessage(`Added — ${summarizeRide(addedRides[0].ride)}`);
    } else {
      setMessage(`Added ${addedRides.length} rides — ready to compare.`);
    }
  };

  return (
    <div className="upload-panel">
      <input
        ref={inputRef}
        type="file"
        accept=".gpx"
        multiple
        className="upload-panel-input"
        onChange={(event) => {
          const files = Array.from(event.target.files ?? []);
          if (files.length > 0) handleFiles(files);
          event.target.value = "";
        }}
      />
      <button
        className="upload-panel-button"
        onClick={() => inputRef.current?.click()}
        disabled={status === "processing" || atCapacity}
      >
        {status === "processing"
          ? "ANALYZING…"
          : atCapacity
            ? `${MAX_LOADED_RIDES}/${MAX_LOADED_RIDES} RIDES LOADED`
            : `UPLOAD GPX (${loadedRides.length}/${MAX_LOADED_RIDES})`}
      </button>

      {loadedRides.length > 0 && (
        <ul className="upload-panel-rides">
          {loadedRides.map((loaded) => (
            <li key={loaded.id} className="upload-panel-ride">
              <span
                className="upload-panel-ride-swatch"
                style={{ background: loaded.color }}
              />
              <span className="upload-panel-ride-label">
                {loaded.label}
                <span className="upload-panel-ride-sublabel">{summarizeRide(loaded.ride)}</span>
              </span>
              <button
                className="upload-panel-ride-remove"
                onClick={() => handleRemoveRide(loaded.id)}
                aria-label="Remove ride"
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      )}

      {message && (
        <p
          role="status"
          aria-live="polite"
          className={`upload-panel-status${status === "error" ? " upload-panel-status--error" : ""}`}
        >
          {message}
        </p>
      )}
    </div>
  );
}
