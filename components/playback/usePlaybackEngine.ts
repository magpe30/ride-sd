"use client";

// Owns the ride-replay animation loop: per-ride arc-length state lives
// in a ref and advances every animation frame via requestAnimationFrame,
// completely outside React state — the same "imperative, no re-render"
// approach RideMap already uses for its route-draw animation. Only
// low-frequency, user-driven changes (play/pause, speed, a ride
// finishing) go through React state, since those are rare enough that
// a re-render is free; per-frame position updates go out through
// `subscribe` instead, so consumers (the map, the chart) can update
// their own imperative DOM/canvas state without this hook re-rendering
// 60 times a second.
import { useCallback, useEffect, useRef, useState } from "react";

import type { Pass } from "@/lib/gpx/passes";
import {
  advanceRidePlayback,
  initialRidePlaybackState,
  type RidePlaybackState,
} from "@/lib/gpx/playback";
import type { LoadedRide } from "@/lib/gpx/session";
import type { SpeedSample } from "@/lib/gpx/speed";

export type PlaybackFrameListener = (states: readonly RidePlaybackState[]) => void;

export type PlaybackEngine = {
  hasPlayableRides: boolean;
  playing: boolean;
  speedMultiplier: number;
  speedMultiplierOptions: readonly number[];
  finishedRideIds: ReadonlySet<string>;
  allFinished: boolean;
  togglePlay: () => void;
  setSpeedMultiplier: (multiplier: number) => void;
  reset: () => void;
  subscribe: (listener: PlaybackFrameListener) => () => void;
  getStates: () => readonly RidePlaybackState[];
};

// Real 1x playback of a real ride (often 20-40+ minutes for these
// routes) would be unwatchable as a demo. These compress the replay
// while still preserving *relative* pacing — a hairpin still reads as
// slower than a sweeper — which flat "constant speed" playback can't.
const SPEED_MULTIPLIER_OPTIONS = [10, 20, 40, 80] as const;
const DEFAULT_SPEED_MULTIPLIER = 20;

// Caps the per-frame time delta so resuming after a dropped/backgrounded
// tab doesn't feed the sim one huge catch-up step (which would look
// like the marker teleporting instead of animating).
const MAX_FRAME_DT_SECONDS = 0.25;

type PlaybackEntry = { pass: Pass; sortedSpeedProfile: SpeedSample[] };

function playableRideIds(loadedRides: readonly LoadedRide[], direction: Pass["direction"] | null): string[] {
  if (!direction) return [];
  return loadedRides
    .filter((loaded) =>
      loaded.ride.passes.some(
        (p) => p.direction === direction && p.samples.length >= 2 && p.speedProfile.length > 0
      )
    )
    .map((loaded) => loaded.id);
}

function buildEntries(
  loadedRides: readonly LoadedRide[],
  direction: Pass["direction"] | null
): Map<string, PlaybackEntry> {
  const entries = new Map<string, PlaybackEntry>();
  if (!direction) return entries;

  for (const loaded of loadedRides) {
    const pass = loaded.ride.passes.find((p) => p.direction === direction);
    if (!pass || pass.samples.length < 2 || pass.speedProfile.length === 0) continue;
    const sortedSpeedProfile = [...pass.speedProfile].sort(
      (a, b) => a.arcLengthMeters - b.arcLengthMeters
    );
    entries.set(loaded.id, { pass, sortedSpeedProfile });
  }

  return entries;
}

export function usePlaybackEngine(
  loadedRides: readonly LoadedRide[],
  direction: Pass["direction"] | null
): PlaybackEngine {
  const [playing, setPlaying] = useState(false);
  const [speedMultiplier, setSpeedMultiplier] = useState<number>(DEFAULT_SPEED_MULTIPLIER);
  const [finishedRideIds, setFinishedRideIds] = useState<ReadonlySet<string>>(new Set());

  const entriesRef = useRef<Map<string, PlaybackEntry>>(new Map());
  const statesRef = useRef<RidePlaybackState[]>([]);
  const listenersRef = useRef<Set<PlaybackFrameListener>>(new Set());
  const speedMultiplierRef = useRef(speedMultiplier);
  const rafRef = useRef<number | null>(null);
  const lastFrameTimeRef = useRef<number | null>(null);

  const activeRideIds = playableRideIds(loadedRides, direction);
  const hasPlayableRides = activeRideIds.length > 0;
  const allFinished =
    activeRideIds.length > 0 && activeRideIds.every((id) => finishedRideIds.has(id));
  // Includes direction explicitly — the same set of ride ids can be
  // playable in both directions, and a direction toggle must still
  // invalidate the cached passes (they'd otherwise keep pointing at the
  // wrong direction's samples).
  const playableKey = `${direction ?? "none"}|${activeRideIds.join(",")}`;

  useEffect(() => {
    speedMultiplierRef.current = speedMultiplier;
  }, [speedMultiplier]);

  const notify = useCallback((states: readonly RidePlaybackState[]) => {
    for (const listener of listenersRef.current) listener(states);
  }, []);

  const resetToStart = useCallback(
    (entries: Map<string, PlaybackEntry>) => {
      const initial: RidePlaybackState[] = [];
      entries.forEach((entry, rideId) => {
        initial.push(initialRidePlaybackState(rideId, entry.pass, entry.sortedSpeedProfile));
      });
      statesRef.current = initial;
      notify(initial);
    },
    [notify]
  );

  // Rebuilds playback entries whenever the active (ride, direction) set
  // changes — a new upload, a removed ride, or a direction toggle all
  // invalidate any in-progress playback, keyed on `playableKey` (a
  // stable string of just the ids that matter) rather than `loadedRides`
  // itself so a same-set reference change doesn't spuriously replay it.
  //
  // The two setState calls below are a deliberate exception to
  // react-hooks/set-state-in-effect: both of React's own documented
  // patterns for "reset state when an external identity changes" —
  // comparing against a ref during render, or setState in a plain
  // effect — are exactly this shape, and this project's stricter
  // lint config flags both. An effect is required here regardless
  // (rebuilding `entriesRef` from the *new* props, and only then
  // resetting playing/finished, must happen after commit — an
  // event-handler-triggered reset would run before the new entries
  // exist and reset against stale data).
  useEffect(() => {
    const entries = buildEntries(loadedRides, direction);
    entriesRef.current = entries;
    lastFrameTimeRef.current = null;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setPlaying(false);
    setFinishedRideIds(new Set());
    resetToStart(entries);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playableKey]);

  useEffect(() => {
    if (!playing) {
      lastFrameTimeRef.current = null;
      return;
    }

    const tick = (now: number) => {
      if (lastFrameTimeRef.current === null) lastFrameTimeRef.current = now;
      const rawDtSeconds = (now - lastFrameTimeRef.current) / 1000;
      lastFrameTimeRef.current = now;
      const dtSeconds = Math.min(MAX_FRAME_DT_SECONDS, rawDtSeconds) * speedMultiplierRef.current;

      const newlyFinished: string[] = [];
      const next = statesRef.current.map((state) => {
        const entry = entriesRef.current.get(state.rideId);
        if (!entry) return state;
        const advanced = advanceRidePlayback(
          state.rideId,
          entry.pass,
          entry.sortedSpeedProfile,
          state,
          dtSeconds
        );
        if (advanced.finished && !state.finished) newlyFinished.push(state.rideId);
        return advanced;
      });
      statesRef.current = next;
      notify(next);

      if (newlyFinished.length > 0) {
        setFinishedRideIds((prev) => {
          const nextSet = new Set(prev);
          for (const id of newlyFinished) nextSet.add(id);
          return nextSet;
        });
      }

      if (next.length > 0 && next.every((s) => s.finished)) {
        setPlaying(false);
        return;
      }

      rafRef.current = requestAnimationFrame(tick);
    };

    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    };
  }, [playing, notify]);

  const togglePlay = useCallback(() => {
    setPlaying((prev) => {
      const startingFresh =
        !prev && statesRef.current.length > 0 && statesRef.current.every((s) => s.finished);
      if (startingFresh) {
        resetToStart(entriesRef.current);
        setFinishedRideIds(new Set());
      }
      return !prev;
    });
  }, [resetToStart]);

  const reset = useCallback(() => {
    setPlaying(false);
    setFinishedRideIds(new Set());
    resetToStart(entriesRef.current);
  }, [resetToStart]);

  const subscribe = useCallback((listener: PlaybackFrameListener) => {
    listenersRef.current.add(listener);
    listener(statesRef.current);
    return () => {
      listenersRef.current.delete(listener);
    };
  }, []);

  const getStates = useCallback(() => statesRef.current, []);

  return {
    hasPlayableRides,
    playing,
    speedMultiplier,
    speedMultiplierOptions: SPEED_MULTIPLIER_OPTIONS,
    finishedRideIds,
    allFinished,
    togglePlay,
    setSpeedMultiplier,
    reset,
    subscribe,
    getStates,
  };
}
