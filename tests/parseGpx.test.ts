import { describe, expect, it } from "vitest";

import {
  MAX_GPX_FILE_BYTES,
  MAX_GPX_TRACK_POINTS,
  parseGpx,
  validateGpxFile,
} from "@/lib/gpx/parse";

function gpxPoint(attributes = 'lat="33.1" lon="-116.8"', time = "2026-01-18T09:08:37Z") {
  return `<trkpt ${attributes}><time>${time}</time></trkpt>`;
}

describe("GPX upload validation", () => {
  it("accepts a valid GPX file and point", () => {
    expect(() => validateGpxFile({ name: "palomar.GPX", size: 1024 })).not.toThrow();
    expect(parseGpx(`<gpx>${gpxPoint()}</gpx>`)).toEqual([
      {
        lat: 33.1,
        lon: -116.8,
        elevationMeters: null,
        timeMs: Date.parse("2026-01-18T09:08:37Z"),
      },
    ]);
  });

  it("rejects a disguised or oversized upload before reading it", () => {
    expect(() => validateGpxFile({ name: "ride.xml", size: 1024 })).toThrow(/ending in \.gpx/i);
    expect(() =>
      validateGpxFile({ name: "ride.gpx", size: MAX_GPX_FILE_BYTES + 1 })
    ).toThrow(/larger than 10 MB/i);
  });

  it.each([
    ["malformed XML", "<gpx><trkpt></gpx>", /malformed XML/i],
    ["non-GPX XML", "<ride />", /not a GPX/i],
    ["document types", "<!DOCTYPE gpx><gpx />", /unsupported XML/i],
    ["custom entities", "<!ENTITY x \"value\"><gpx />", /unsupported XML/i],
    ["missing points", "<gpx />", /does not contain any track points/i],
  ])("rejects %s", (_name, xml, expected) => {
    expect(() => parseGpx(xml)).toThrow(expected);
  });

  it.each([
    ['lat="91" lon="-116.8"', "2026-01-18T09:08:37Z", /invalid latitude/i],
    ['lat="33.1" lon="-181"', "2026-01-18T09:08:37Z", /invalid longitude/i],
    ['lat="33.1" lon="-116.8"', "not-a-date", /invalid timestamp/i],
  ])("rejects invalid track-point data", (attributes, time, expected) => {
    expect(() => parseGpx(`<gpx>${gpxPoint(attributes, time)}</gpx>`)).toThrow(expected);
  });

  it("rejects more track points than the processing limit", () => {
    const point = gpxPoint();
    const xml = `<gpx>${point.repeat(MAX_GPX_TRACK_POINTS + 1)}</gpx>`;

    expect(() => parseGpx(xml)).toThrow(/more than 100,000 track points/i);
  });
});
