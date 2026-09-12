"use client";

import { useEffect, useRef } from "react";

import type { LoadedRide } from "@/lib/gpx/session";

import type { PlaybackEngine } from "./usePlaybackEngine";

type PlaybackBarProps = {
  engine: PlaybackEngine;
  loadedRides: readonly LoadedRide[];
};

const MPS_TO_MPH = 2.23694;

export default function PlaybackBar({ engine, loadedRides }: PlaybackBarProps) {
  const speedRefs = useRef<Map<string, HTMLSpanElement>>(new Map());

  // Live mph readout per ride — the clearest, most unambiguous proof
  // that a replay is following the ride's actual recorded speed (not a
  // flat pace): at this zoomed-out overview scale, a real slowdown
  // through a hairpin barely changes the marker's on-screen motion, so
  // the number is what actually shows it happening. Updated
  // imperatively (not React state) to stay at the animation's frame
  // rate without re-rendering the whole bar every frame.
  useEffect(() => {
    const unsubscribe = engine.subscribe((states) => {
      for (const state of states) {
        const el = speedRefs.current.get(state.rideId);
        if (el) el.textContent = `${Math.round(state.speedMps * MPS_TO_MPH)} mph`;
      }
    });
    return unsubscribe;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [engine.subscribe]);

  if (!engine.hasPlayableRides) return null;

  return (
    <div className="playback-bar">
      <button
        type="button"
        className="playback-bar-play"
        onClick={engine.togglePlay}
        aria-label={engine.playing ? "Pause replay" : engine.allFinished ? "Replay" : "Play replay"}
        title={engine.playing ? "Pause" : engine.allFinished ? "Replay" : "Play"}
      >
        {engine.playing ? (
          <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
            <rect x="3" y="2" width="3.5" height="12" rx="1" fill="currentColor" />
            <rect x="9.5" y="2" width="3.5" height="12" rx="1" fill="currentColor" />
          </svg>
        ) : (
          <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
            <path d="M4 2.5 L13.5 8 L4 13.5 Z" fill="currentColor" />
          </svg>
        )}
      </button>

      <button
        type="button"
        className="playback-bar-reset"
        onClick={engine.reset}
        aria-label="Reset replay to start"
        title="Reset to start"
      >
        <svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true">
          <path
            d="M13 8a5 5 0 1 1-1.6-3.68"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
          />
          <path d="M13 2.5v3.2h-3.2" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      <div className="playback-bar-divider" />

      <div className="playback-bar-speeds">
        {engine.speedMultiplierOptions.map((option) => (
          <button
            key={option}
            type="button"
            className={`playback-bar-speed${option === engine.speedMultiplier ? " playback-bar-speed--active" : ""}`}
            onClick={() => engine.setSpeedMultiplier(option)}
          >
            {option}×
          </button>
        ))}
      </div>

      <div className="playback-bar-divider" />

      <div className="playback-bar-rides">
        {loadedRides.map((loaded) => {
          const finished = engine.finishedRideIds.has(loaded.id);
          return (
            <span
              key={loaded.id}
              className={`playback-bar-ride${finished ? " playback-bar-ride--finished" : ""}`}
            >
              <span className="playback-bar-ride-dot" style={{ background: loaded.color }} />
              {loaded.label}
              <span
                className="playback-bar-ride-speed"
                ref={(el) => {
                  if (el) speedRefs.current.set(loaded.id, el);
                  else speedRefs.current.delete(loaded.id);
                }}
              >
                — mph
              </span>
              {finished && <span className="playback-bar-ride-check">✓</span>}
            </span>
          );
        })}
      </div>
    </div>
  );
}
