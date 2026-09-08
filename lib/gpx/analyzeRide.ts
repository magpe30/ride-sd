// Orchestrates the full pipeline for an uploaded GPX: figures out which
// loaded route it belongs to (whichever reference line it map-matches
// against best), then runs pass-segmentation, speed smoothing, and
// per-corner metrics for each pass found.
import type { Route } from "@/data/routes";
import { detectCorners } from "../geo/corners";
import { matchTrackToLine, type MatchedSample } from "./mapMatch";
import { splitIntoPasses, type Pass } from "./passes";
import type { TrackPoint } from "./parse";
import { deriveSpeedProfile, type SpeedSample } from "./speed";
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

// Below this many matched points, treat it as "doesn't actually cover
// any loaded route" rather than force a low-confidence match.
const MIN_MATCHED_SAMPLES = 30;

export function detectAndAnalyzeRide(
  track: readonly TrackPoint[],
  routes: readonly Route[]
): AnalyzedRide | null {
  let best: { route: Route; matched: MatchedSample[] } | null = null;

  for (const route of routes) {
    const matched = matchTrackToLine(track, route.line.coordinates);
    if (!best || matched.length > best.matched.length) {
      best = { route, matched };
    }
  }

  if (!best || best.matched.length < MIN_MATCHED_SAMPLES) return null;

  const corners = detectCorners(best.route.line.coordinates);

  const passes: AnalyzedPass[] = splitIntoPasses(best.matched).map((pass) => {
    const speedProfile = deriveSpeedProfile(pass.samples);
    return {
      direction: pass.direction,
      samples: pass.samples,
      speedProfile,
      cornerMetrics: computeAllCornerMetrics(corners, speedProfile, pass.direction),
    };
  });

  return { route: best.route, passes };
}
