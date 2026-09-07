import type { Feature, LineString } from "geojson";

import { countCorners } from "@/lib/geo/corners";
import palomarMountainLoop from "./geo/palomar-mountain-loop.json";
import sunriseHighway from "./geo/sunrise-highway.json";
import montezumaValleyRoad from "./geo/montezuma-valley-road.json";
import bannerGrade from "./geo/banner-grade.json";

type RouteGeometry = Feature<LineString, { name: string; distanceMiles: number }>;

export type Route = {
  id: string;
  name: string;
  markerLabel: string;
  markerCoordinate: [number, number];
  distanceMiles: number;
  cornerCount: number;
  description: string;
  line: LineString;
};

export const routes: Route[] = [
  {
    id: "palomar-mountain-loop",
    name: "Palomar Mountain — South Grade / East Grade",
    markerLabel: "PALOMAR",
    // The junction near the summit where South Grade Rd (CR S6) meets
    // East Grade Rd (CR S7).
    markerCoordinate: [-116.8654, 33.313],
    distanceMiles: (palomarMountainLoop as RouteGeometry).properties.distanceMiles,
    cornerCount: countCorners((palomarMountainLoop as RouteGeometry).geometry.coordinates),
    description:
      "Climb South Grade Road from Hwy 76, crest near the summit junction, and descend East Grade Road toward Lake Henshaw.",
    line: (palomarMountainLoop as RouteGeometry).geometry,
  },
  {
    id: "sunrise-highway",
    name: "Sunrise Highway",
    markerLabel: "SUNRISE",
    // Near Mount Laguna, roughly the midpoint of the climb.
    markerCoordinate: [-116.418, 32.87],
    distanceMiles: (sunriseHighway as RouteGeometry).properties.distanceMiles,
    cornerCount: countCorners((sunriseHighway as RouteGeometry).geometry.coordinates),
    description:
      "A high-country ridgeline run through Mount Laguna, with long sightlines down into the Anza-Borrego desert.",
    line: (sunriseHighway as RouteGeometry).geometry,
  },
  {
    id: "montezuma-valley-road",
    name: "Montezuma Valley Road",
    markerLabel: "MONTEZUMA",
    // The top of the Montezuma-Borrego Highway grade, where the switchback
    // descent into Borrego Springs begins.
    markerCoordinate: [-116.4866, 33.211],
    distanceMiles: (montezumaValleyRoad as RouteGeometry).properties.distanceMiles,
    cornerCount: countCorners((montezumaValleyRoad as RouteGeometry).geometry.coordinates),
    description:
      "A steep switchback descent from the Santa Ysabel highlands down into Borrego Springs and the desert floor.",
    line: (montezumaValleyRoad as RouteGeometry).geometry,
  },
  {
    id: "banner-grade",
    name: "Banner Grade",
    markerLabel: "JULIAN",
    markerCoordinate: [-116.603, 33.079],
    distanceMiles: (bannerGrade as RouteGeometry).properties.distanceMiles,
    cornerCount: countCorners((bannerGrade as RouteGeometry).geometry.coordinates),
    description:
      "Drops out of Julian through tight switchbacks into Banner and Sentenac Canyon toward Scissors Crossing.",
    line: (bannerGrade as RouteGeometry).geometry,
  },
];
