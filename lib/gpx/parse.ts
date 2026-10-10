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

export const MAX_GPX_FILE_BYTES = 10 * 1024 * 1024;
export const MAX_GPX_TRACK_POINTS = 100_000;

export function validateGpxFile(file: Pick<File, "name" | "size">): void {
  if (!file.name.toLowerCase().endsWith(".gpx")) {
    throw new Error("Choose a GPX file ending in .gpx.");
  }

  if (file.size > MAX_GPX_FILE_BYTES) {
    throw new Error("This GPX is larger than 10 MB. Export a smaller ride and try again.");
  }
}

export function parseGpx(xmlText: string): TrackPoint[] {
  // GPX does not need document types or custom entities. Rejecting them also
  // keeps this parser safe if it is ever moved from the browser to a different
  // XML implementation with more permissive external-entity behavior.
  if (/<!DOCTYPE|<!ENTITY/i.test(xmlText)) {
    throw new Error("This GPX contains unsupported XML declarations.");
  }

  const doc = new DOMParser().parseFromString(xmlText, "application/xml");
  if (doc.getElementsByTagName("parsererror").length > 0) {
    throw new Error("This GPX contains malformed XML.");
  }

  if (doc.documentElement.localName.toLowerCase() !== "gpx") {
    throw new Error("This file is XML, but it is not a GPX recording.");
  }

  const trkpts = doc.getElementsByTagName("trkpt");
  if (trkpts.length === 0) {
    throw new Error("This GPX does not contain any track points.");
  }
  if (trkpts.length > MAX_GPX_TRACK_POINTS) {
    throw new Error(
      `This GPX contains more than ${MAX_GPX_TRACK_POINTS.toLocaleString()} track points. Export a shorter ride and try again.`
    );
  }

  const points: TrackPoint[] = [];

  for (let index = 0; index < trkpts.length; index += 1) {
    const trkpt = trkpts[index];
    const lat = parseFloat(trkpt.getAttribute("lat") ?? "");
    const lon = parseFloat(trkpt.getAttribute("lon") ?? "");
    const timeText = trkpt.getElementsByTagName("time")[0]?.textContent ?? null;
    const timeMs = timeText ? Date.parse(timeText) : NaN;
    const eleText = trkpt.getElementsByTagName("ele")[0]?.textContent ?? null;

    if (!Number.isFinite(lat) || lat < -90 || lat > 90) {
      throw new Error(`Track point ${index + 1} has an invalid latitude.`);
    }
    if (!Number.isFinite(lon) || lon < -180 || lon > 180) {
      throw new Error(`Track point ${index + 1} has an invalid longitude.`);
    }
    if (!Number.isFinite(timeMs)) {
      throw new Error(`Track point ${index + 1} has an invalid timestamp.`);
    }

    const parsedElevation = eleText === null ? null : Number.parseFloat(eleText);

    points.push({
      lat,
      lon,
      elevationMeters: parsedElevation !== null && Number.isFinite(parsedElevation)
        ? parsedElevation
        : null,
      timeMs,
    });
  }

  return points;
}
