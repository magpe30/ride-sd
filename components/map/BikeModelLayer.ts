// A MapLibre custom WebGL layer that renders the 3D motorcycle model
// via three.js, sharing MapLibre's own GL context and canvas rather
// than a separate overlay — the standard technique for putting a real
// 3D object into a MapLibre/Mapbox scene (see MapLibre's "Add a 3D
// model" example, which this general approach follows, adapted for
// MapLibre v6's projection-matrix API — see the worldSize comment
// below for the one meaningful difference from that classic example).
//
// At true real-world scale (~2m), the model is only usefully visible
// with the camera zoomed in close — a route-overview zoom makes any
// real-world-sized object a barely visible speck, same as a real
// motorcycle would be from that height. A chase/follow camera is a
// planned, separate step for exactly this reason.
import type { CustomLayerInterface, Map as MapLibreMap } from "maplibre-gl";
import { MercatorCoordinate } from "maplibre-gl";
import * as THREE from "three";
import { DRACOLoader } from "three/addons/loaders/DRACOLoader.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";

const MODEL_URL = "/models/motorcycle.glb";
const DRACO_DECODER_PATH = "/draco/";

// The GLB isn't modeled at real-world meter scale (Sketchfab-style
// downloads rarely are) — this converts the model's own units to
// meters before MapLibre's meter-to-Mercator-unit scale is applied on
// top. Starting at 1 and tuned empirically once the model is actually
// visible next to the road.
// The model's longest raw dimension is ~1.11 units; a real motorcycle
// is roughly 2.2m long, so 1 unit ≈ 2 real-world meters.
const MODEL_METERS_PER_UNIT = 2;

export type BikeModelLayerHandle = {
  layer: CustomLayerInterface;
  /** Position and orientation in world terms — degrees, compass heading, 0 = north. */
  setTransform: (lng: number, lat: number, headingDegrees: number, leanDegrees: number) => void;
  setVisible: (visible: boolean) => void;
};

export function createBikeModelLayer(id: string): BikeModelLayerHandle {
  let mapRef: MapLibreMap | null = null;
  let scene: THREE.Scene | null = null;
  let camera: THREE.PerspectiveCamera | THREE.Camera | null = null;
  let renderer: THREE.WebGLRenderer | null = null;
  let modelRoot: THREE.Object3D | null = null;

  let lng = 0;
  let lat = 0;
  let headingRad = 0;
  let leanRad = 0;
  let visible = true;

  const layer: CustomLayerInterface = {
    id,
    type: "custom",
    renderingMode: "3d",

    onAdd(map, gl) {
      mapRef = map;
      camera = new THREE.Camera();
      scene = new THREE.Scene();

      scene.add(new THREE.HemisphereLight(0xffffff, 0x33334d, 2.4));
      const sun = new THREE.DirectionalLight(0xffffff, 2.2);
      sun.position.set(0, -70, 100).normalize();
      scene.add(sun);

      const dracoLoader = new DRACOLoader();
      dracoLoader.setDecoderPath(DRACO_DECODER_PATH);
      const gltfLoader = new GLTFLoader();
      gltfLoader.setDRACOLoader(dracoLoader);
      gltfLoader.load(
        MODEL_URL,
        (gltf) => {
          modelRoot = gltf.scene;
          scene?.add(modelRoot);
          mapRef?.triggerRepaint();
        },
        undefined,
        (error) => {
          console.error("Failed to load motorcycle model:", error);
        }
      );

      renderer = new THREE.WebGLRenderer({
        canvas: map.getCanvas(),
        context: gl,
        antialias: true,
      });
      renderer.autoClear = false;
    },

    render(_gl, options) {
      if (!visible || !modelRoot || !scene || !camera || !renderer) return;

      // MapLibre v6's `modelViewProjectionMatrix` (unlike the classic
      // Mapbox custom-layer example this pattern is otherwise based on)
      // expects positions in *world-pixel* space — raw Mercator
      // coordinates ([0,1] range) multiplied by `worldSize` — not raw
      // Mercator coordinates directly. Confirmed by reading MapLibre's
      // own Transform._calcMatrices(): the matrix it hands to custom
      // layers is built from `projectToWorldCoordinates(worldSize,
      // center)`, one step past where the (unexposed) mercatorMatrix
      // variant used to normalize back to raw [0,1] units. Both the
      // translation and the scale need this same worldSize factor to
      // stay dimensionally consistent with each other.
      const worldSize = 512 * Math.pow(2, mapRef?.getZoom() ?? 0);
      const modelAsMercator = MercatorCoordinate.fromLngLat([lng, lat], 0);
      const scale =
        modelAsMercator.meterInMercatorCoordinateUnits() * MODEL_METERS_PER_UNIT * worldSize;

      // glTF is Y-up; MapLibre's world space is Z-up. The fixed 90°
      // rotation around X converts the model's own "up" to match, and
      // is applied outermost (last in this chain) so heading and lean
      // rotate the model in its own original frame first, matching the
      // pattern from MapLibre's own 3D-model example.
      const correctionX = new THREE.Matrix4().makeRotationAxis(
        new THREE.Vector3(1, 0, 0),
        Math.PI / 2
      );
      const heading = new THREE.Matrix4().makeRotationAxis(
        new THREE.Vector3(0, 1, 0),
        headingRad
      );
      const lean = new THREE.Matrix4().makeRotationAxis(new THREE.Vector3(0, 0, 1), leanRad);

      const localTransform = new THREE.Matrix4()
        .makeTranslation(
          modelAsMercator.x * worldSize,
          modelAsMercator.y * worldSize,
          modelAsMercator.z * worldSize
        )
        .scale(new THREE.Vector3(scale, -scale, scale))
        .multiply(correctionX)
        .multiply(heading)
        .multiply(lean);

      const mvp = new THREE.Matrix4().fromArray(
        options.modelViewProjectionMatrix as unknown as number[]
      );
      (camera as THREE.Camera & { projectionMatrix: THREE.Matrix4 }).projectionMatrix =
        mvp.multiply(localTransform);

      renderer.resetState();
      renderer.render(scene, camera);
      mapRef?.triggerRepaint();
    },
  };

  return {
    layer,
    setTransform(newLng, newLat, headingDegrees, leanDegrees) {
      lng = newLng;
      lat = newLat;
      // Empirically characterized against the loaded model (screenshots
      // at compass headings 0/90/180/270): the model's own rotationY=0
      // pose faces compass east, and rotationY increases clockwise on
      // screen, opposite of compass bearing's sense — so visual compass
      // angle = 90 - rotationYDegrees. Solving for the rotationY needed
      // to display a given compass heading gives this inverse.
      headingRad = ((90 - headingDegrees) * Math.PI) / 180;
      leanRad = (leanDegrees * Math.PI) / 180;
    },
    setVisible(nextVisible) {
      visible = nextVisible;
    },
  };
}
