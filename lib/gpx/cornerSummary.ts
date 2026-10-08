import type { CornerMetrics } from "./cornerMetrics";

const MPS_TO_MPH = 2.23694;
const MATCH_THRESHOLD_MPH = 0.1;

function speedDifference(currentMps: number, baselineMps: number): number {
  return (currentMps - baselineMps) * MPS_TO_MPH;
}

function comparisonPhrase(
  differenceMph: number,
  positive: string,
  negative: string,
  matched: string
): string {
  if (Math.abs(differenceMph) < MATCH_THRESHOLD_MPH) return matched;
  return `${Math.abs(differenceMph).toFixed(1)} mph ${differenceMph > 0 ? positive : negative}`;
}

export function comparisonCornerSummary(
  slot: string,
  current: CornerMetrics | undefined,
  baseline: CornerMetrics | undefined
): string {
  if (!current || !baseline) {
    return `${slot} does not have enough coverage for a complete comparison with A.`;
  }

  const entry = comparisonPhrase(
    speedDifference(current.approachSpeedMps, baseline.approachSpeedMps),
    "faster on entry",
    "slower on entry",
    "the same as A on entry"
  );
  const minimum = comparisonPhrase(
    speedDifference(current.minSpeedMps, baseline.minSpeedMps),
    "higher at minimum speed",
    "lower at minimum speed",
    "the same as A at minimum speed"
  );
  const exit = comparisonPhrase(
    speedDifference(current.exitSpeedMps, baseline.exitSpeedMps),
    "faster on exit",
    "slower on exit",
    "the same as A on exit"
  );

  return `${slot} was ${entry}, ${minimum}, and ${exit}.`;
}

export function singleCornerSummary(metrics: CornerMetrics): string {
  const minimum = metrics.minSpeedMps * MPS_TO_MPH;
  const lost = metrics.speedLostMps * MPS_TO_MPH;
  const gained = metrics.speedGainedMps * MPS_TO_MPH;
  return `Minimum ${minimum.toFixed(1)} mph after losing ${lost.toFixed(
    1
  )} mph from entry; gained ${gained.toFixed(1)} mph by exit.`;
}
