import type { CornerMetrics } from "./cornerMetrics";

const MPS_TO_MPH = 2.23694;
const MEANINGFUL_SPEED_RANGE_CHANGE_MPH = 0.5;
const MEANINGFUL_POSITION_CHANGE_METERS = 8;

export type CoachingTone = "steady" | "improved" | "changed" | "unavailable";

export type CoachingInsight = {
  label: "PREPARATION" | "STABILITY" | "CONSISTENCY";
  value: string;
  detail: string;
  tone: CoachingTone;
};

function positionLabel(progress: number): string {
  if (progress < 0.34) return "EARLY";
  if (progress > 0.66) return "LATE";
  return "MID-CORNER";
}

function travelDistanceToMinimum(metrics: CornerMetrics): number {
  return metrics.minimumSpeedProgress * metrics.cornerLengthMeters;
}

function signedMeters(value: number): string {
  return `${Math.abs(value).toFixed(0)} m ${value < 0 ? "earlier" : "later"}`;
}

export function minimumSpeedLocation(metrics: CornerMetrics): string {
  return `${Math.round(metrics.minimumSpeedProgress * 100)}% through`;
}

export function buildCornerCoachingInsights(
  chronologicalMetrics: readonly (CornerMetrics | undefined)[]
): CoachingInsight[] {
  const available = chronologicalMetrics.filter(
    (metrics): metrics is CornerMetrics => metrics !== undefined
  );
  const latest = available.at(-1);

  if (!latest) {
    return [
      {
        label: "PREPARATION",
        value: "NO DATA",
        detail: "This ride does not fully cover the corner.",
        tone: "unavailable",
      },
      {
        label: "STABILITY",
        value: "NO DATA",
        detail: "A complete corner trace is needed.",
        tone: "unavailable",
      },
      {
        label: "CONSISTENCY",
        value: "NO DATA",
        detail: "Compare complete passes of this corner.",
        tone: "unavailable",
      },
    ];
  }

  const baseline = available[0];
  const latestMinimumDistance = travelDistanceToMinimum(latest);
  const baselineMinimumDistance = travelDistanceToMinimum(baseline);
  const positionDelta = latestMinimumDistance - baselineMinimumDistance;
  const rangeMph = latest.speedRangeMps * MPS_TO_MPH;
  const baselineRangeMph = baseline.speedRangeMps * MPS_TO_MPH;
  const rangeDeltaMph = rangeMph - baselineRangeMph;

  const preparation: CoachingInsight = available.length === 1
    ? {
        label: "PREPARATION",
        value: positionLabel(latest.minimumSpeedProgress),
        detail: `Minimum speed occurred ${minimumSpeedLocation(latest)} the corner.`,
        tone: "steady",
      }
    : {
        label: "PREPARATION",
        value:
          Math.abs(positionDelta) < MEANINGFUL_POSITION_CHANGE_METERS
            ? "SIMILAR POINT"
            : positionDelta < 0
              ? "EARLIER MINIMUM"
              : "LATER MINIMUM",
        detail:
          Math.abs(positionDelta) < MEANINGFUL_POSITION_CHANGE_METERS
            ? `Minimum speed stayed within ${MEANINGFUL_POSITION_CHANGE_METERS} m of the baseline point.`
            : `Minimum speed occurred ${signedMeters(positionDelta)} than the baseline.`,
        tone:
          Math.abs(positionDelta) < MEANINGFUL_POSITION_CHANGE_METERS
            ? "steady"
            : "changed",
      };

  const stability: CoachingInsight = available.length === 1
    ? {
        label: "STABILITY",
        value: `${rangeMph.toFixed(1)} MPH RANGE`,
        detail: "Difference between the lowest and highest speed inside the corner.",
        tone: "steady",
      }
    : {
        label: "STABILITY",
        value:
          Math.abs(rangeDeltaMph) < MEANINGFUL_SPEED_RANGE_CHANGE_MPH
            ? "SIMILAR RANGE"
            : rangeDeltaMph < 0
              ? "STEADIER"
              : "MORE VARIABLE",
        detail:
          Math.abs(rangeDeltaMph) < MEANINGFUL_SPEED_RANGE_CHANGE_MPH
            ? `Speed range remained about ${rangeMph.toFixed(1)} mph.`
            : `Speed varied ${Math.abs(rangeDeltaMph).toFixed(1)} mph ${rangeDeltaMph < 0 ? "less" : "more"} than the baseline.`,
        tone:
          rangeDeltaMph < -MEANINGFUL_SPEED_RANGE_CHANGE_MPH
            ? "improved"
            : Math.abs(rangeDeltaMph) < MEANINGFUL_SPEED_RANGE_CHANGE_MPH
              ? "steady"
              : "changed",
      };

  const minimumDistances = available.map(travelDistanceToMinimum);
  const spreadMeters = Math.max(...minimumDistances) - Math.min(...minimumDistances);
  const consistency: CoachingInsight = available.length === 1
    ? {
        label: "CONSISTENCY",
        value: "NEEDS 2 RIDES",
        detail: "Add another ride to compare repeatability.",
        tone: "unavailable",
      }
    : {
        label: "CONSISTENCY",
        value: spreadMeters <= 12 ? "REPEATABLE" : spreadMeters <= 25 ? "CLOSE" : "VARIABLE",
        detail: `Minimum-speed points span ${spreadMeters.toFixed(0)} m across ${available.length} rides.`,
        tone: spreadMeters <= 12 ? "improved" : spreadMeters <= 25 ? "steady" : "changed",
      };

  return [preparation, stability, consistency];
}
