// Parses a GPX file's <trkpt> elements into plain track points. Uses the
// browser's native DOMParser — zero bundle cost, and GPX is simple enough
// that we don't need a full XML library. For Node-side scripts/tests,
// polyfill `globalThis.DOMParser` (e.g. with @xmldom/xmldom) before
// calling this.
export type TrackPoint = {
  lon: number;
  lat: number;
  elevationMeters: number | null;
  timeMs: number;
};

export function parseGpx(xmlText: string): TrackPoint[] {
  const doc = new DOMParser().parseFromString(xmlText, "application/xml");
  const trkpts = Array.from(doc.getElementsByTagName("trkpt"));

  const points: TrackPoint[] = [];

  for (const trkpt of trkpts) {
    const lat = parseFloat(trkpt.getAttribute("lat") ?? "");
    const lon = parseFloat(trkpt.getAttribute("lon") ?? "");
    const timeText = trkpt.getElementsByTagName("time")[0]?.textContent ?? null;
    const timeMs = timeText ? Date.parse(timeText) : NaN;
    const eleText = trkpt.getElementsByTagName("ele")[0]?.textContent ?? null;

    if (Number.isNaN(lat) || Number.isNaN(lon) || Number.isNaN(timeMs)) continue;

    points.push({
      lat,
      lon,
      elevationMeters: eleText ? parseFloat(eleText) : null,
      timeMs,
    });
  }

  return points;
}
