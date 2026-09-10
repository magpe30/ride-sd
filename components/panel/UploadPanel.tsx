"use client";

import { useRef, useState } from "react";

import { routes } from "@/data/routes";
import { detectAndAnalyzeRide, type AnalyzedRide } from "@/lib/gpx/analyzeRide";
import { parseGpx } from "@/lib/gpx/parse";
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

export default function UploadPanel({ loadedRides, onAddRide, onRemoveRide }: UploadPanelProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [status, setStatus] = useState<Status>("idle");
  const [message, setMessage] = useState<string | null>(null);

  const activeRoute = loadedRides[0]?.ride.route ?? null;
  const atCapacity = loadedRides.length >= MAX_LOADED_RIDES;

  const handleFile = async (file: File) => {
    if (atCapacity) {
      setStatus("error");
      setMessage(`Already comparing ${MAX_LOADED_RIDES} rides — remove one to add another.`);
      return;
    }

    setStatus("processing");
    setMessage(null);

    try {
      const text = await file.text();
      const track = parseGpx(text);
      const analyzed = detectAndAnalyzeRide(track, routes);

      if (!analyzed) {
        setStatus("error");
        setMessage("No match — this GPX doesn't overlap any loaded route.");
        return;
      }

      if (activeRoute && analyzed.route.id !== activeRoute.id) {
        setStatus("error");
        setMessage(
          `This GPX matches "${analyzed.route.name}", but you're comparing rides on "${activeRoute.name}". Remove the current rides first to switch routes.`
        );
        return;
      }

      setStatus("done");
      setMessage(`Added — ${summarizeRide(analyzed)}`);
      onAddRide(createLoadedRide(analyzed, loadedRides, deriveRideLabel(file.name)));
    } catch (error) {
      setStatus("error");
      setMessage(error instanceof Error ? error.message : "Failed to parse GPX file.");
    }
  };

  return (
    <div className="upload-panel">
      <input
        ref={inputRef}
        type="file"
        accept=".gpx"
        className="upload-panel-input"
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) handleFile(file);
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
                onClick={() => onRemoveRide(loaded.id)}
                aria-label="Remove ride"
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      )}

      {message && (
        <p className={`upload-panel-status${status === "error" ? " upload-panel-status--error" : ""}`}>
          {message}
        </p>
      )}
    </div>
  );
}
