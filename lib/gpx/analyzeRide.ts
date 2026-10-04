// Orchestrates the full pipeline for an uploaded GPX: figures out which
// loaded route it belongs to (whichever reference line it map-matches
// against best), then runs pass-segmentation, speed smoothing, and
// per-corner metrics for each pass found.
import type { Route } from "@/data/routes";
import { detectCorners } from "../geo/corners";
import { matchTrackToLine, type MatchedSample } from "./mapMatch";
import { splitIntoPasses, type Pass } from "./passes";
import type { TrackPoint } from "./parse";
import { deriveSpeedProfile, removeStationaryBreaks, type SpeedSample } from "./speed";
import { computeAllCornerMetrics, type CornerMetrics } from "./cornerMetrics";

export type AnalyzedPass = {
  direction: Pass["direction"];
  samples: MatchedSample[];
  speedProfile: SpeedSample[];
  cornerMetrics: CornerMetrics[];
};

export type AnalyzedRide = {
  route: Route;
  passes: AnalyzedPass[];
};

export type RideAnalysisResult =
  | { ok: true; ride: AnalyzedRide }
  | { ok: false; reason: "no-route-match" | "ambiguous-route" | "no-usable-pass" };

// Below this many matched points, treat it as "doesn't actually cover
// any loaded route" rather than force a low-confidence match.
const MIN_MATCHED_SAMPLES = 30;
const MIN_ROUTE_MARGIN_SAMPLES = 10;
const MIN_ROUTE_MARGIN_RATIO = 0.1;

export function analyzeRide(
  track: readonly TrackPoint[],
  routes: readonly Route[]
): RideAnalysisResult {
  const matches = routes
    .map((route) => ({ route, matched: matchTrackToLine(track, route.line.coordinates) }))
    .sort((a, b) => b.matched.length - a.matched.length);

  const best = matches[0];
  if (!best || best.matched.length < MIN_MATCHED_SAMPLES) {
    return { ok: false, reason: "no-route-match" };
  }

  const second = matches[1];
  const requiredMargin = Math.max(
    MIN_ROUTE_MARGIN_SAMPLES,
    Math.ceil(best.matched.length * MIN_ROUTE_MARGIN_RATIO)
  );
  if (second && best.matched.length - second.matched.length < requiredMargin) {
    return { ok: false, reason: "ambiguous-route" };
  }

  const corners = detectCorners(best.route.line.coordinates);

  const passes: AnalyzedPass[] = splitIntoPasses(best.matched).map((pass) => {
    const samples = removeStationaryBreaks(pass.samples);
    const speedProfile = deriveSpeedProfile(samples);
    return {
      direction: pass.direction,
      samples,
      speedProfile,
      cornerMetrics: computeAllCornerMetrics(corners, speedProfile, pass.direction),
    };
  });

  if (passes.length === 0) return { ok: false, reason: "no-usable-pass" };

  return { ok: true, ride: { route: best.route, passes } };
}

export function detectAndAnalyzeRide(
  track: readonly TrackPoint[],
  routes: readonly Route[]
): AnalyzedRide | null {
  const result = analyzeRide(track, routes);
  return result.ok ? result.ride : null;
}
