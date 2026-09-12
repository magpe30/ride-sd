import { copyFileSync, mkdirSync } from "node:fs";
import path from "node:path";

// DRACOLoader.setDecoderPath() needs these served as static files — the
// motorcycle model (public/models/motorcycle.glb) uses
// KHR_draco_mesh_compression, so three.js can't decode its geometry
// without them. The gltf/ subfolder (rather than the top-level draco/
// one) is the build three.js's own GLTFLoader examples point at.
//
// Resolved as a plain node_modules path rather than via
// require.resolve("three/package.json") — three's package.json
// "exports" field doesn't expose that subpath, so resolution fails.
const dist = path.join(
  process.cwd(),
  "node_modules",
  "three",
  "examples",
  "jsm",
  "libs",
  "draco",
  "gltf"
);

const dest = path.join(process.cwd(), "public", "draco");

mkdirSync(dest, { recursive: true });

for (const file of ["draco_decoder.js", "draco_decoder.wasm", "draco_wasm_wrapper.js"]) {
  copyFileSync(path.join(dist, file), path.join(dest, file));
}
