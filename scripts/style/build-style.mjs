// Repaints OpenFreeMap's free "liberty" style into a dark "night ride" theme
// for the ride map. We only override color-bearing paint/text properties —
// widths, zoom interpolations, and layouts from the base style are left
// untouched. Re-run after refreshing base-liberty.json from
// https://tiles.openfreemap.org/styles/liberty if OpenFreeMap ships a schema
// change.
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const baseStylePath = fileURLToPath(
  new URL("./base-liberty.json", import.meta.url)
);
const outputPath = fileURLToPath(
  new URL("../../public/map/style.json", import.meta.url)
);

const palette = {
  bgVoid: "#0a0e13",
  waterFill: "#050a12",
  waterLine: "#13202c",
  waterLabel: "#3f5670",

  vegWood: "#132018",
  vegGrass: "#101c14",
  vegWetland: "#0e1c1e",
  vegIce: "#1a2128",
  parkFill: "#14261b",
  parkOutline: "#1c3626",
  settlementFill: "#10141a",
  sandFill: "#241f14",
  mutedFill: "#161a20",
  mutedLine: "#2a323c",

  casingDark: "#05070a",
  motorwayCasing: "#14171b",
  motorwayColor: "#828a94",
  trunkColor: "#6e767f",
  secondaryColor: "#4f5760",
  minorColor: "#2c323a",
  pedColor: "#333a42",
  railColor: "#4a4358",

  buildingFill: "#12161d",
  boundaryColor: "#3a4552",

  textHalo: "#05070a",
  roadLabel: "#8f99a6",
  placeOther: "#7d8894",
  placeTown: "#93a0ae",
  placeCity: "#c7d2de",
  placeCapital: "#ffe6c2",
};

// Maps a layer id (or id prefix) to the paint overrides it should receive.
// Matching is by exact id first, then by prefix, so e.g. "tunnel_motorway",
// "road_motorway", and "bridge_motorway" all share the motorway ruleset.
const rules = [
  { match: (id) => id === "background", paint: { "background-color": palette.bgVoid } },
  { match: (id) => id === "natural_earth", hide: true },

  { match: (id) => id === "park", paint: { "fill-color": palette.parkFill, "fill-outline-color": palette.parkOutline } },
  { match: (id) => id === "park_outline", paint: { "line-color": palette.parkOutline } },

  { match: (id) => id === "landcover_wood", paint: { "fill-color": palette.vegWood } },
  { match: (id) => id === "landcover_grass", paint: { "fill-color": palette.vegGrass } },
  { match: (id) => id === "landcover_wetland", paint: { "fill-color": palette.vegWetland } },
  { match: (id) => id === "landcover_ice", paint: { "fill-color": palette.vegIce } },
  { match: (id) => id === "landcover_sand", paint: { "fill-color": palette.sandFill } },

  { match: (id) => id === "landuse_residential", paint: { "fill-color": palette.settlementFill } },
  { match: (id) => /^landuse_(pitch|track|cemetery|hospital|school)$/.test(id), paint: { "fill-color": palette.settlementFill } },

  { match: (id) => id === "water", paint: { "fill-color": palette.waterFill } },
  { match: (id) => /^waterway_(tunnel|river|other)$/.test(id), paint: { "line-color": palette.waterLine } },

  { match: (id) => /^aeroway_(fill)$/.test(id), paint: { "fill-color": palette.mutedFill } },
  { match: (id) => /^aeroway_(runway|taxiway)$/.test(id), paint: { "line-color": palette.mutedLine } },

  { match: (id) => id === "building", paint: { "fill-color": palette.buildingFill, "fill-outline-color": palette.casingDark } },
  { match: (id) => id === "building-3d", paint: { "fill-extrusion-color": palette.buildingFill } },

  { match: (id) => /^boundary_/.test(id), paint: { "line-color": palette.boundaryColor } },

  // Roads: casings first (more specific), then fills.
  { match: (id) => /_motorway(_link)?_casing$/.test(id), paint: { "line-color": palette.motorwayCasing } },
  { match: (id) => /_(trunk_primary|secondary_tertiary|minor|link|service_track|street|path_pedestrian)_casing$/.test(id), paint: { "line-color": palette.casingDark } },

  { match: (id) => /_motorway(_link)?$/.test(id) && /^(road|tunnel|bridge)_/.test(id), paint: { "line-color": palette.motorwayColor } },
  { match: (id) => /_trunk_primary$/.test(id), paint: { "line-color": palette.trunkColor } },
  { match: (id) => /_secondary_tertiary$/.test(id), paint: { "line-color": palette.secondaryColor } },
  { match: (id) => /_(minor|link|service_track|street)$/.test(id), paint: { "line-color": palette.minorColor } },
  { match: (id) => /_path_pedestrian$/.test(id), paint: { "line-color": palette.pedColor } },
  { match: (id) => /_(major_rail|transit_rail)(_hatching)?$/.test(id), paint: { "line-color": palette.railColor } },
  { match: (id) => id === "road_area_pattern", paint: { "fill-color": palette.mutedFill } },

  { match: (id) => /^poi_/.test(id), hide: true },

  { match: (id) => /^highway-name-/.test(id) || id === "road_shield_us", paint: { "text-color": palette.roadLabel, "text-halo-color": palette.textHalo } },
  { match: (id) => id === "waterway_line_label" || /^water_name_/.test(id), paint: { "text-color": palette.waterLabel, "text-halo-color": palette.textHalo } },
  { match: (id) => id === "airport", paint: { "text-color": palette.roadLabel, "text-halo-color": palette.textHalo } },

  { match: (id) => id === "label_country_1" || id === "label_country_2" || id === "label_country_3" || id === "label_state", paint: { "text-color": palette.placeOther, "text-halo-color": palette.textHalo } },
  { match: (id) => id === "label_city_capital", paint: { "text-color": palette.placeCapital, "text-halo-color": palette.textHalo } },
  { match: (id) => id === "label_city", paint: { "text-color": palette.placeCity, "text-halo-color": palette.textHalo } },
  { match: (id) => id === "label_town", paint: { "text-color": palette.placeTown, "text-halo-color": palette.textHalo } },
  { match: (id) => id === "label_village" || id === "label_other", paint: { "text-color": palette.placeOther, "text-halo-color": palette.textHalo } },
];

function applyRules(layer) {
  const matched = rules.find((rule) => rule.match(layer.id));
  if (!matched) return layer;

  if (matched.hide) {
    return {
      ...layer,
      layout: { ...layer.layout, visibility: "none" },
    };
  }

  return {
    ...layer,
    paint: { ...layer.paint, ...matched.paint },
  };
}

const base = JSON.parse(await readFile(baseStylePath, "utf8"));

const styled = {
  ...base,
  layers: base.layers.map(applyRules),
};

await writeFile(outputPath, JSON.stringify(styled, null, 2) + "\n");

console.log(`Wrote ${outputPath}`);
