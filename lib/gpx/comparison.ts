import type { AnalyzedPass, AnalyzedRide } from "./analyzeRide";
import type { Pass } from "./passes";
import { RIDE_COLORS, type LoadedRide } from "./session";

export const COMPARISON_SLOTS = ["A", "B", "C"] as const;

export type ComparisonSlot = (typeof COMPARISON_SLOTS)[number];

export type ComparisonRide = LoadedRide & {
  comparison: {
    slot: ComparisonSlot;
    sourceRideId: string;
    passIndex: number;
    startTimeMs: number;
  };
};

type PassCandidate = {
  source: LoadedRide;
  pass: AnalyzedPass;
  passIndex: number;
  startTimeMs: number;
  sourceOrder: number;
};

export type RouteValidationResult =
  | { ok: true }
  | { ok: false; message: string };

export function validateComparisonRoute(
  candidate: AnalyzedRide,
  existing: readonly LoadedRide[]
): RouteValidationResult {
  const currentRoute = existing[0]?.ride.route;
  if (!currentRoute || currentRoute.id === candidate.route.id) return { ok: true };

  return {
    ok: false,
    message: `This ride matches “${candidate.route.name}”. Your current comparison contains “${currentRoute.name}” rides. Remove the current rides first to switch routes.`,
  };
}

function passStartTime(pass: AnalyzedPass): number {
  return pass.samples[0]?.timeMs ?? Number.POSITIVE_INFINITY;
}

function candidatesForDirection(
  loadedRides: readonly LoadedRide[],
  direction: Pass["direction"]
): PassCandidate[] {
  return loadedRides
    .flatMap((source, sourceOrder) =>
      source.ride.passes.flatMap((pass, passIndex) =>
        pass.direction === direction
          ? [{ source, pass, passIndex, startTimeMs: passStartTime(pass), sourceOrder }]
          : []
      )
    )
    .sort(
      (a, b) =>
        a.startTimeMs - b.startTimeMs ||
        a.sourceOrder - b.sourceOrder ||
        a.passIndex - b.passIndex
    );
}

function defaultCandidates(candidates: readonly PassCandidate[]): PassCandidate[] {
  if (candidates.length <= COMPARISON_SLOTS.length) return [...candidates];

  // Keep the original baseline and the two most recent passes. This
  // preserves the long-term reference while emphasizing current progress.
  return [candidates[0], ...candidates.slice(-2)];
}

export function buildComparisonRides(
  loadedRides: readonly LoadedRide[],
  direction: Pass["direction"] | null
): ComparisonRide[] {
  if (!direction) return [];

  const allCandidates = candidatesForDirection(loadedRides, direction);
  const sourceCounts = new Map<string, number>();
  for (const candidate of allCandidates) {
    sourceCounts.set(candidate.source.id, (sourceCounts.get(candidate.source.id) ?? 0) + 1);
  }

  return defaultCandidates(allCandidates).map((candidate, index) => {
    const slot = COMPARISON_SLOTS[index];
    const needsPassLabel = (sourceCounts.get(candidate.source.id) ?? 0) > 1;

    return {
      ...candidate.source,
      id: `${candidate.source.id}:pass-${candidate.passIndex}`,
      color: RIDE_COLORS[index],
      label: needsPassLabel
        ? `${candidate.source.label} · Pass ${candidate.passIndex + 1}`
        : candidate.source.label,
      ride: {
        ...candidate.source.ride,
        passes: [candidate.pass],
      },
      comparison: {
        slot,
        sourceRideId: candidate.source.id,
        passIndex: candidate.passIndex,
        startTimeMs: candidate.startTimeMs,
      },
    };
  });
}

export function displayTurnDirection(
  direction: Pass["direction"],
  turn: "left" | "right"
): "left" | "right" {
  if (direction === "forward") return turn;
  return turn === "left" ? "right" : "left";
}
