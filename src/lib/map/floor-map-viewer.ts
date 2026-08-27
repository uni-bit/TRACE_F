import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";

import { buildElevatorShaft } from "./build-features";
import { buildFloorGroup, type FloorHandle } from "./build-floor-group";
import { footprintFor } from "./buildings";
import { buildingPlacement, LEVEL_HEIGHT, planTransform, type PlanTransform } from "./plan-transform";
import { DEFAULT_TWEAKS, type MapTweaks } from "./tweaks";
import type { BuildingDefinition, CameraMode, MapLayer } from "./types";

// How every layer reads is a reading decision, not a constant: the whole set
// lives in tweaks.ts and arrives through setTweaks(), so it can be adjusted
// against the actual screen instead of guessed here. The values below are only
// the starting point the panel opens on.
/** The shafts read the same whatever floor is picked — they are the skewer. */
const SHAFT_OPACITY = 0.16;
/** Breathing room around the campus when a camera mode frames it. */
const FRAME_MARGIN = 1.08;
const MAX_PIXEL_RATIO = 2;
/** Clearance under the lowest slab, so a basement does not sit in the ground. */
const GROUND_DROP = 0.15;
const GROUND_TEXTURE_SIZE = 2048;
const GROUND_GRID_PITCH = 64;
/** Frame-rate independent: 60Hz and 120Hz reach the target in the same time. */
const TONE_TAU = 0.12;
const TONE_EPSILON = 1e-3;
const MAP_LAYERS: MapLayer[] = [
  "slab",
  "plan",
  "walls",
  "cores",
  "furniture",
  "outline",
  "shafts",
];

const WORLD_UP = new THREE.Vector3(0, 1, 0);
/** True north in world space, which is what the campus is turned to face. */
const NORTH_VECTOR = new THREE.Vector3(0, 0, -1);
/**
 * Plan space -> world. The world's -z is true north, so the campus group is
 * turned by minus the plan's north bearing and every plan coordinate that the
 * camera has to reason about (bounds, centre) comes through here. The bearing
 * is a tweak, not a constant — PLAN_NORTH_BEARING_DEG is what it is measured
 * to be, and whether to apply it is a reading decision.
 */
function campusYawFor(tweaks: MapTweaks): number {
  return -THREE.MathUtils.degToRad(tweaks.northBearingDeg);
}
function planToWorld(x: number, z: number, yaw: number): { x: number; z: number } {
  const cos = Math.cos(yaw);
  const sin = Math.sin(yaw);
  return { x: x * cos + z * sin, z: -x * sin + z * cos };
}
const FLY_KEYS = new Set(["KeyW", "KeyA", "KeyS", "KeyD", "KeyQ", "KeyE", "ShiftLeft", "ShiftRight"]);
const FLY_SPEED = 2.2;
const FLY_BOOST = 3;
/** Long frames (a backgrounded tab) must not teleport the camera. */
const MAX_FRAME_SECONDS = 0.05;

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/** Per-layer alpha whose repeated composition reaches `stackOpacity`. */
function opacityForStack(stackOpacity: number, layerCount: number): number {
  if (stackOpacity === 0 || layerCount === 0) return 0;
  return 1 - Math.pow(1 - stackOpacity, 1 / layerCount);
}

function isTextEntry(element: Element | null): boolean {
  if (!(element instanceof HTMLElement)) return false;
  return element.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(element.tagName);
}

type FloorTone = {
  plan: number;
  wall: number;
  slab: number;
  outline: number;
  core: number;
  furniture: number;
  lift: number;
};

const TONE_KEYS: (keyof FloorTone)[] = [
  "plan",
  "wall",
  "slab",
  "outline",
  "core",
  "furniture",
  "lift",
];

/**
 * Centre glow plus a fine grid. The ground is what turns six floating sheets
 * into one building standing somewhere (§15.2).
 */
function createGroundTexture(): THREE.CanvasTexture | null {
  const canvas = document.createElement("canvas");
  canvas.width = GROUND_TEXTURE_SIZE;
  canvas.height = GROUND_TEXTURE_SIZE;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  const size = GROUND_TEXTURE_SIZE;
  const mid = size / 2;

  ctx.fillStyle = "#0b1420";
  ctx.fillRect(0, 0, size, size);
  const glow = ctx.createRadialGradient(mid, mid, 0, mid, mid, mid);
  glow.addColorStop(0, "rgba(101, 198, 168, 0.34)");
  glow.addColorStop(0.35, "rgba(101, 198, 168, 0.11)");
  glow.addColorStop(1, "rgba(11, 20, 32, 0)");
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, size, size);

  ctx.strokeStyle = "rgba(141, 228, 196, 0.11)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let p = 0; p <= size; p += GROUND_GRID_PITCH) {
    ctx.moveTo(p + 0.5, 0);
    ctx.lineTo(p + 0.5, size);
    ctx.moveTo(0, p + 0.5);
    ctx.lineTo(size, p + 0.5);
  }
  ctx.stroke();

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

/**
 * Imperative three.js viewer, deliberately React-free: it is constructed once
 * per canvas lifetime and mutated through the set* methods, so floor/camera
 * changes never rebuild the GL context, shaders, or textures.
 */
export class FloorMapViewer {
  private readonly container: HTMLElement;
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene: THREE.Scene;
  private readonly camera: THREE.PerspectiveCamera;
  private readonly controls: OrbitControls;
  private readonly transform: PlanTransform;
  private readonly floors: FloorHandle[];
  private readonly textures: THREE.Texture[] = [];
  private readonly campusGroup: THREE.Group;
  private readonly structureGroup: THREE.Group;
  private readonly shaftGroup: THREE.Group;
  private readonly layerVisibility = Object.fromEntries(
    MAP_LAYERS.map((layer) => [layer, true]),
  ) as Record<MapLayer, boolean>;
  private readonly pressed = new Set<string>();
  private readonly shafts: { column: THREE.Mesh; topLevel: number }[] = [];
  private readonly composer: EffectComposer | null;
  private readonly bloomPass: UnrealBloomPass | null;
  private readonly renderTarget: THREE.WebGLRenderTarget | null;
  private readonly toneTarget: FloorTone[] = [];
  private readonly toneCurrent: FloorTone[] = [];
  private lastFrame = 0;
  private readonly resizeObserver: ResizeObserver;
  private readonly buildingHeight: number;
  /** y of the lowest slab: below 0 wherever a building has a basement. */
  private readonly campusFloorY: number;
  private readonly campusCenter: THREE.Vector3;
  private campusWidth: number;
  private campusDepth: number;
  private readonly planWidth: number;
  private readonly planDepth: number;
  /** Plan-space corners of every building, for re-framing when the yaw moves. */
  private readonly planCorners: { x: number; z: number }[];
  private tweaks: MapTweaks;
  private cameraMode: CameraMode = "orbit";
  private raf = 0;
  private needsRender = true;
  private disposed = false;
  private selectedLevel: number | null = null;
  private debugStack = false;
  private viewListener: ((northScreenAngleDeg: number) => void) | null = null;
  private lastNorthAngle = Number.NaN;

  constructor(
    container: HTMLElement,
    buildings: BuildingDefinition[],
    effects = true,
    tweaks: MapTweaks = DEFAULT_TWEAKS,
  ) {
    if (buildings.length === 0) throw new Error("FloorMapViewer needs at least one building");
    this.tweaks = structuredClone(tweaks);
    const yaw = campusYawFor(this.tweaks);
    const primary = buildings[0];
    const placements = new Map(
      buildings.map((building) => [building.id, buildingPlacement(building.masterRect, primary.masterRect)]),
    );
    // Every corner, not the two extremes of an axis-aligned box: once the
    // campus is turned to true north the plan's own bounding box is no longer
    // the world's, and framing off it would leave the model cut or adrift.
    const planCorners = buildings.flatMap((building) => {
      const placement = placements.get(building.id)!;
      const halfWidth = placement.transform.width / 2;
      const halfDepth = placement.transform.depth / 2;
      return [-1, 1].flatMap((sx) =>
        [-1, 1].map((sz) => ({
          x: placement.offsetX + sx * halfWidth,
          z: placement.offsetZ + sz * halfDepth,
        })),
      );
    });
    this.planCorners = planCorners;
    const corners = planCorners.map((corner) => planToWorld(corner.x, corner.z, yaw));
    const minX = Math.min(...corners.map((corner) => corner.x));
    const maxX = Math.max(...corners.map((corner) => corner.x));
    const minZ = Math.min(...corners.map((corner) => corner.z));
    const maxZ = Math.max(...corners.map((corner) => corner.z));
    const levels = buildings.flatMap((building) => building.floors.map((floor) => floor.level));
    this.container = container;
    this.transform = planTransform(primary.plan);
    // Kept alongside the world extents because the orbit viewpoint is chosen
    // against the buildings, not against the compass: it wants a corner of the
    // plan, which after the campus is turned is no longer a corner of the world.
    this.planWidth = Math.max(...planCorners.map((c) => c.x)) - Math.min(...planCorners.map((c) => c.x));
    this.planDepth = Math.max(...planCorners.map((c) => c.z)) - Math.min(...planCorners.map((c) => c.z));
    // Levels are not 1..n any more: the headquarters has a basement, so the
    // stack starts below y=0 and the ground has to get out of its way.
    this.campusFloorY = (Math.min(...levels) - 1) * LEVEL_HEIGHT;
    this.buildingHeight = Math.max(...levels) * LEVEL_HEIGHT;
    this.campusCenter = new THREE.Vector3((minX + maxX) / 2, 0, (minZ + maxZ) / 2);
    this.campusWidth = maxX - minX;
    this.campusDepth = maxZ - minZ;

    // Opaque, unlike v1: EffectComposer does not compose over a transparent
    // clear, so the background moves into the scene and the CSS gradient stays
    // only as a pre-first-frame fallback.
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.15;
    this.renderer.domElement.className = "campus-3d-canvas";
    container.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(this.tweaks.colour.background);
    this.scene.fog = new THREE.FogExp2(this.tweaks.colour.background, this.tweaks.fogDensity);
    this.scene.add(new THREE.HemisphereLight(0xbfd8ff, 0x1a2030, 0.95));
    const sun = new THREE.DirectionalLight(0xffffff, 0.65);
    sun.position.set(5, 10, 4);
    this.scene.add(sun);

    // Everything modelled hangs off this, and only this is turned: the plan
    // pipeline keeps working in drawing coordinates while the scene it lands in
    // has true north down -z. The ground and its grid stay on the scene, so the
    // grid reads as the compass rose the buildings sit askew on — which they do.
    this.campusGroup = new THREE.Group();
    this.campusGroup.rotation.y = yaw;
    this.scene.add(this.campusGroup);

    const groundTexture = createGroundTexture();
    if (groundTexture) {
      this.textures.push(groundTexture);
      const groundGeometry = new THREE.PlaneGeometry(
        Math.max(this.transform.width * 6, this.campusWidth * 3),
        Math.max(this.transform.depth * 6, this.campusDepth * 3),
      );
      groundGeometry.rotateX(-Math.PI / 2);
      // FrontSide on purpose: flying below it with Q must not black out the view.
      const ground = new THREE.Mesh(
        groundGeometry,
        new THREE.MeshBasicMaterial({ map: groundTexture, fog: true, depthWrite: false }),
      );
      ground.position.y = this.campusFloorY - GROUND_DROP;
      ground.position.x = this.campusCenter.x;
      ground.position.z = this.campusCenter.z;
      ground.renderOrder = -1;
      this.scene.add(ground);
    }

    this.camera = new THREE.PerspectiveCamera(45, 1, 0.1, 120);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.minDistance = 3.5;
    this.controls.maxDistance = 48;
    this.controls.maxPolarAngle = 1.35;
    this.controls.addEventListener("change", () => {
      this.needsRender = true;
    });

    const loader = new THREE.TextureLoader();
    const maxAnisotropy = this.renderer.capabilities.getMaxAnisotropy();
    this.floors = buildings.flatMap((building) => {
      const placement = placements.get(building.id)!;
      return building.floors.map((floor) => {
        const handle = buildFloorGroup(
          floor,
          placement.transform,
          footprintFor(building, floor.id),
        );
        handle.group.position.x = placement.offsetX;
        handle.group.position.z = placement.offsetZ;
        this.campusGroup.add(handle.group);
        const texture = loader.load(floor.texture, () => {
          if (this.disposed) return;
          texture.colorSpace = THREE.SRGBColorSpace;
          texture.anisotropy = maxAnisotropy;
          handle.planMaterial.map = texture;
          handle.planMaterial.needsUpdate = true;
          this.needsRender = true;
        });
        this.textures.push(texture);
        return handle;
      });
    });
    this.structureGroup = new THREE.Group();
    this.shaftGroup = new THREE.Group();
    this.structureGroup.add(this.shaftGroup);
    this.campusGroup.add(this.structureGroup);
    // Emissive, not merely lit: a Lambert box this transparent picks up almost
    // no light against the night ground, so the shafts read as grey monoliths
    // punched out of the sky instead of glass running through the building.
    const shaftSolid = new THREE.MeshLambertMaterial({
      color: 0x8de4c4,
      emissive: 0x2f7f68,
      transparent: true,
      opacity: SHAFT_OPACITY,
      depthWrite: false,
    });
    for (const building of buildings) {
      const placement = placements.get(building.id)!;
      const topLevel = Math.max(...building.floors.map((floor) => floor.level));
      for (const shaft of building.features.elevators) {
        const column = new THREE.Mesh(buildElevatorShaft(shaft, placement.transform), shaftSolid);
        column.position.set(placement.offsetX, 0, placement.offsetZ);
        column.renderOrder = 100;
        this.shaftGroup.add(column);
        this.shafts.push({ column, topLevel });
      }
    }
    if (effects) {
      // samples: 4 is not optional — drawing into a render target disables the
      // context's own antialiasing, and this is what buys v1's edge quality back.
      this.renderTarget = new THREE.WebGLRenderTarget(1, 1, {
        type: THREE.HalfFloatType,
        samples: 4,
      });
      this.composer = new EffectComposer(this.renderer, this.renderTarget);
      this.composer.addPass(new RenderPass(this.scene, this.camera));
      this.bloomPass = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.35, 0.6, 0.55);
      this.composer.addPass(this.bloomPass);
      this.composer.addPass(new OutputPass());
    } else {
      this.renderTarget = null;
      this.composer = null;
      this.bloomPass = null;
    }

    this.applyFloorAppearance();
    this.snapFloorTones();

    this.setCameraMode("orbit");
    window.addEventListener("keydown", this.onKeyDown);
    window.addEventListener("keyup", this.onKeyUp);
    window.addEventListener("blur", this.onBlur);
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(container);
    this.resize();
    this.raf = requestAnimationFrame(this.renderLoop);
  }

  /**
   * The whole appearance in one call. Everything here is a material, a pass
   * setting or a transform — nothing rebuilds geometry — so a slider can be
   * dragged at frame rate without the GL context noticing.
   */
  setTweaks(tweaks: MapTweaks): void {
    const previousBearing = this.tweaks.northBearingDeg;
    this.tweaks = structuredClone(tweaks);

    const background = new THREE.Color(this.tweaks.colour.background);
    if (this.scene.background instanceof THREE.Color) this.scene.background.copy(background);
    if (this.scene.fog instanceof THREE.FogExp2) {
      this.scene.fog.color.copy(background);
      this.scene.fog.density = this.tweaks.fogDensity;
    }
    this.renderer.toneMappingExposure = this.tweaks.exposure;
    if (this.bloomPass) {
      // Disabled is strength 0 rather than a pass removed: dropping a pass out
      // of the composer mid-session re-allocates its render targets, and the
      // only thing the reader asked for was less glow.
      this.bloomPass.strength = this.tweaks.bloom.enabled ? this.tweaks.bloom.strength : 0;
      this.bloomPass.radius = this.tweaks.bloom.radius;
      this.bloomPass.threshold = this.tweaks.bloom.threshold;
    }
    for (const floor of this.floors) {
      floor.slabMaterial.color.set(this.tweaks.colour.slab);
      floor.wallMaterial.color.set(this.tweaks.colour.wall);
      floor.outlineMaterial.color.set(this.tweaks.colour.outline);
      floor.planMaterial.color.set(this.tweaks.colour.plan);
      floor.coreMaterial?.color.set(this.tweaks.colour.core);
      floor.furnitureMaterial?.color.set(this.tweaks.colour.furniture);
    }

    if (this.tweaks.northBearingDeg !== previousBearing) {
      const yaw = campusYawFor(this.tweaks);
      this.campusGroup.rotation.y = yaw;
      const corners = this.planCorners.map((corner) => planToWorld(corner.x, corner.z, yaw));
      const minX = Math.min(...corners.map((corner) => corner.x));
      const maxX = Math.max(...corners.map((corner) => corner.x));
      const minZ = Math.min(...corners.map((corner) => corner.z));
      const maxZ = Math.max(...corners.map((corner) => corner.z));
      this.campusCenter.set((minX + maxX) / 2, 0, (minZ + maxZ) / 2);
      this.campusWidth = maxX - minX;
      this.campusDepth = maxZ - minZ;
      // The frame was solved against the old footprint; turning the campus
      // under a camera that is not re-solved leaves it half out of shot.
      this.setCameraMode(this.cameraMode);
    }

    this.applyFloorAppearance();
    this.needsRender = true;
  }

  setSelectedFloor(level: number | null): void {
    this.selectedLevel = level;
    this.applyFloorAppearance();
    this.writeStructureVisibility();
  }

  /**
   * Report where true north ends up on screen, in degrees clockwise from the
   * top of the viewport, whenever the camera moves. The compass has to be told
   * rather than assumed: the old rose was painted at 0° and left there, which
   * was wrong in ORBIT and, before the campus was turned, wrong in NORTH too.
   */
  setViewListener(listener: ((northScreenAngleDeg: number) => void) | null): void {
    this.viewListener = listener;
    this.lastNorthAngle = Number.NaN;
    this.emitViewState();
  }

  private emitViewState(): void {
    if (!this.viewListener) return;
    // project() reads matrixWorldInverse, which only the renderer refreshes.
    // Called straight after a camera move that is one line old, it would
    // otherwise answer for where the camera used to be.
    this.camera.updateMatrixWorld();
    const origin = this.controls.target.clone().project(this.camera);
    const ahead = this.controls.target.clone().add(NORTH_VECTOR).project(this.camera);
    const dx = ahead.x - origin.x;
    const dy = ahead.y - origin.y;
    // Degenerate only if north is edge-on, which maxPolarAngle rules out.
    if (dx === 0 && dy === 0) return;
    const angle = (THREE.MathUtils.radToDeg(Math.atan2(dx, dy)) + 360) % 360;
    if (Math.abs(angle - this.lastNorthAngle) < 0.5) return;
    this.lastNorthAngle = angle;
    this.viewListener(angle);
  }

  setCameraMode(mode: CameraMode): void {
    this.cameraMode = mode;
    const target = this.campusCenter.clone();
    if (mode === "north") {
      // Plan view: only the footprint has to fit, so frame the ground extent
      // and leave the target at grade rather than mid-stack. North is up here
      // because the campus itself is turned, not because the camera is rolled.
      target.y = 0;
      const up = new THREE.Vector3(0, 1, 0.0001).normalize();
      this.camera.position.copy(target).addScaledVector(up, this.fitDistance(target, up));
    } else {
      // Looking from this quadrant keeps all four building stacks legible
      // without the taller headquarters hiding the lower buildings. The
      // quadrant is the plan's, then turned with the campus — the whole point
      // is which buildings stand in front of which, and that is a fact about
      // the drawing, not about north. The distance is whatever actually fits
      // the campus in the viewport we have, so the model is not left as an
      // island in the middle of a wide frame.
      target.y = this.buildingHeight * 0.35;
      const horizontal = planToWorld(
        -this.planWidth * 1.15,
        -this.planDepth * 0.95,
        campusYawFor(this.tweaks),
      );
      const direction = new THREE.Vector3(
        horizontal.x,
        Math.max(this.buildingHeight * 2.4, Math.max(this.campusWidth, this.campusDepth) * 0.9),
        horizontal.z,
      ).normalize();
      this.camera.position
        .copy(target)
        .addScaledVector(direction, this.fitDistance(target, direction));
    }
    this.controls.target.copy(target);
    this.controls.update();
    this.needsRender = true;
    // Ahead of the next frame: the readout belongs to the mode change, not to
    // whenever the render loop next happens to run.
    this.emitViewState();
  }

  /**
   * Nearest distance along `direction` at which all eight corners of the campus
   * box still project inside the frustum. A bounding *sphere* would do here and
   * be one line, but the campus is a wide flat slab, so its circumscribed
   * sphere is far larger than the silhouette from any real viewing angle — the
   * camera would sit back far enough to leave the model an island in the middle
   * of the frame. Both field of views are tested: a wide viewport runs out of
   * room vertically, a tall one horizontally. Dollying past maxDistance would
   * silently undo the fit, so that limit moves with it.
   */
  private fitDistance(target: THREE.Vector3, direction: THREE.Vector3): number {
    const vertical = Math.tan(((this.camera.fov * Math.PI) / 180) / 2);
    const horizontal = vertical * this.camera.aspect;
    // Straight down has no horizon to take "right" from; on-screen up is -z
    // there, which the campus's own rotation has made true north.
    const overhead = Math.abs(direction.dot(WORLD_UP)) > 0.999;
    const right = overhead
      ? new THREE.Vector3(1, 0, 0)
      : new THREE.Vector3().crossVectors(WORLD_UP, direction).normalize();
    const up = overhead
      ? new THREE.Vector3(0, 0, -1)
      : new THREE.Vector3().crossVectors(direction, right).normalize();

    const halfWidth = this.campusWidth / 2;
    const halfDepth = this.campusDepth / 2;
    const corner = new THREE.Vector3();
    let distance = 0;
    for (const x of [-halfWidth, halfWidth]) {
      for (const z of [-halfDepth, halfDepth]) {
        for (const y of [this.campusFloorY, this.buildingHeight]) {
          corner.set(this.campusCenter.x + x, y, this.campusCenter.z + z).sub(target);
          const depth = corner.dot(direction);
          distance = Math.max(
            distance,
            depth + (Math.abs(corner.dot(up)) * FRAME_MARGIN) / vertical,
            depth + (Math.abs(corner.dot(right)) * FRAME_MARGIN) / horizontal,
          );
        }
      }
    }
    this.controls.maxDistance = Math.max(this.controls.maxDistance, distance);
    return distance;
  }

  setLayerVisibility(layer: MapLayer, on: boolean): void {
    this.layerVisibility[layer] = on;
    this.writeFloorTones();
    this.writeStructureVisibility();
    this.needsRender = true;
  }

  /** Development aid: collapse every floor onto y=0 to eyeball registration. */
  setDebugStack(on: boolean): void {
    this.debugStack = on;
    // A shaft spanning six storeys is meaningless once they all sit on y=0.
    this.writeStructureVisibility();
    this.applyFloorAppearance();
  }

  dispose(): void {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    window.removeEventListener("keydown", this.onKeyDown);
    window.removeEventListener("keyup", this.onKeyUp);
    window.removeEventListener("blur", this.onBlur);
    this.resizeObserver.disconnect();
    this.controls.dispose();
    for (const texture of this.textures) texture.dispose();
    this.scene.traverse((obj) => {
      if (obj instanceof THREE.Mesh || obj instanceof THREE.Line) {
        obj.geometry.dispose();
        const materials = Array.isArray(obj.material) ? obj.material : [obj.material];
        for (const material of materials) material.dispose();
      }
    });
    this.bloomPass?.dispose();
    this.composer?.dispose();
    this.renderTarget?.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }

  /** Writes targets only; the render loop eases towards them (§15.4). */
  private applyFloorAppearance(): void {
    const dimmedCount = this.selectedLevel === null
      ? 0
      : this.floors.filter((floor) => floor.level !== this.selectedLevel).length;
    const stack = this.tweaks.dimmedStack;
    const dimmed = {
      plan: opacityForStack(stack.plan, dimmedCount),
      wall: opacityForStack(stack.wall, dimmedCount),
      slab: opacityForStack(stack.slab, dimmedCount),
      outline: opacityForStack(stack.outline, dimmedCount),
      core: opacityForStack(stack.core, dimmedCount),
      furniture: opacityForStack(stack.furniture, dimmedCount),
    };
    this.floors.forEach((floor, i) => {
      const selected = this.selectedLevel === floor.level;
      const tone =
        this.selectedLevel === null ? this.tweaks.all : selected ? this.tweaks.selected : dimmed;
      this.toneTarget[i] = {
        ...tone,
        lift: this.debugStack ? 0 : floor.baseY + (selected ? this.tweaks.selectedLift : 0),
      };
    });
    this.needsRender = true;
  }

  private snapFloorTones(): void {
    this.toneTarget.forEach((tone, i) => {
      this.toneCurrent[i] = { ...tone };
    });
    this.writeFloorTones();
  }

  /** Returns true on any frame that changed something, snapping included. */
  private stepFloorTones(dt: number): boolean {
    const blend = 1 - Math.exp(-dt / TONE_TAU);
    let active = false;
    this.toneCurrent.forEach((current, i) => {
      const target = this.toneTarget[i];
      for (const key of TONE_KEYS) {
        const gap = target[key] - current[key];
        // Exact, because the snap below assigns the target itself: once a value
        // has landed it reports no work, and the loop is allowed to stop.
        if (gap === 0) continue;
        current[key] = Math.abs(gap) < TONE_EPSILON ? target[key] : current[key] + gap * blend;
        active = true;
      }
    });
    if (active) this.writeFloorTones();
    return active;
  }

  private writeFloorTones(): void {
    this.floors.forEach((floor, i) => {
      const tone = this.toneCurrent[i];
      floor.planMaterial.opacity = tone.plan;
      floor.wallMaterial.opacity = tone.wall;
      floor.slabMaterial.opacity = tone.slab;
      floor.outlineMaterial.opacity = tone.outline;
      floor.planMesh.visible = this.layerVisibility.plan && tone.plan > 0;
      if (floor.wallMesh) floor.wallMesh.visible = this.layerVisibility.walls && tone.wall > 0;
      floor.slabMesh.visible = this.layerVisibility.slab && tone.slab > 0;
      floor.outlineMesh.visible = this.layerVisibility.outline && tone.outline > 0;
      if (floor.coreMaterial && floor.coreMesh) {
        floor.coreMaterial.opacity = tone.core;
        floor.coreMesh.visible = this.layerVisibility.cores && tone.core > 0;
      }
      if (floor.furnitureMaterial && floor.furnitureMesh) {
        floor.furnitureMaterial.opacity = tone.furniture;
        floor.furnitureMesh.visible = this.layerVisibility.furniture && tone.furniture > 0;
      }
      floor.group.position.y = tone.lift;
    });
  }

  private writeStructureVisibility(): void {
    this.structureGroup.visible = !this.debugStack;
    this.shaftGroup.visible = this.layerVisibility.shafts;
    // Pick a floor above a building's roof and its shaft is the only thing
    // left of it on screen: a lit column standing over an empty patch of
    // ground, reading as a mistake rather than as the core of a building that
    // simply is not this tall. It skewers the floors it actually serves.
    for (const { column, topLevel } of this.shafts) {
      column.visible = this.selectedLevel === null || this.selectedLevel <= topLevel;
    }
  }

  private renderFrame(): void {
    if (this.composer) this.composer.render();
    else this.renderer.render(this.scene, this.camera);
  }

  private resize(): void {
    const width = this.container.clientWidth;
    const height = this.container.clientHeight;
    if (width === 0 || height === 0) return;
    const pixelRatio = Math.min(window.devicePixelRatio, MAX_PIXEL_RATIO);
    this.renderer.setPixelRatio(pixelRatio);
    this.renderer.setSize(width, height);
    if (this.composer) {
      this.composer.setPixelRatio(pixelRatio);
      this.composer.setSize(width, height);
    }
    this.bloomPass?.resolution.set(width, height);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.needsRender = true;
    // Where north lands on screen is a projected direction, so it moves with
    // the aspect ratio — including the first resize, which is the one that
    // replaces the 1:1 the camera was constructed with.
    this.emitViewState();
  }

  private readonly onKeyDown = (event: KeyboardEvent): void => {
    // Leave browser shortcuts and any focused field alone. A focused floor
    // button still flies, but W/A/S/D mean nothing to a button.
    if (event.ctrlKey || event.metaKey || isTextEntry(document.activeElement)) return;
    if (!FLY_KEYS.has(event.code)) return;
    this.pressed.add(event.code);
    this.needsRender = true;
  };

  private readonly onKeyUp = (event: KeyboardEvent): void => {
    this.pressed.delete(event.code);
  };

  /** Without this, leaving the tab mid-stride leaves the key held forever. */
  private readonly onBlur = (): void => {
    this.pressed.clear();
  };

  /**
   * Pure pan: camera and orbit target take the same delta, so the pivot travels
   * along and the view can still be orbited in place after moving.
   */
  private flyStep(dt: number): void {
    if (this.pressed.size === 0) return;

    const forward = new THREE.Vector3().subVectors(this.controls.target, this.camera.position);
    forward.y = 0;
    if (forward.lengthSq() < 1e-8) {
      // Straight down (NORTH): the horizontal component of the view direction
      // is gone, so steer by the camera's own up axis instead — on screen that
      // is the top of the viewport, which in NORTH is true north.
      this.camera.updateMatrixWorld();
      forward.setFromMatrixColumn(this.camera.matrixWorld, 1);
      forward.y = 0;
      if (forward.lengthSq() < 1e-8) return;
    }
    forward.normalize();
    const right = new THREE.Vector3().crossVectors(forward, WORLD_UP).normalize();

    const step = new THREE.Vector3();
    if (this.pressed.has("KeyW")) step.add(forward);
    if (this.pressed.has("KeyS")) step.sub(forward);
    if (this.pressed.has("KeyD")) step.add(right);
    if (this.pressed.has("KeyA")) step.sub(right);
    if (this.pressed.has("KeyE")) step.y += 1;
    if (this.pressed.has("KeyQ")) step.y -= 1;
    if (step.lengthSq() === 0) return;

    const boosted = this.pressed.has("ShiftLeft") || this.pressed.has("ShiftRight");
    step.normalize().multiplyScalar(FLY_SPEED * (boosted ? FLY_BOOST : 1) * dt);

    const target = this.controls.target;
    const from = target.clone();
    target.add(step);
    target.x = clamp(target.x, this.campusCenter.x - this.campusWidth * 2, this.campusCenter.x + this.campusWidth * 2);
    target.z = clamp(target.z, this.campusCenter.z - this.campusDepth * 2, this.campusCenter.z + this.campusDepth * 2);
    target.y = clamp(target.y, this.campusFloorY - 1, this.buildingHeight + 8);
    // Whatever the clamp actually allowed, not what was asked for.
    this.camera.position.add(target.clone().sub(from));
    this.needsRender = true;
  }

  private readonly renderLoop = (now: number): void => {
    if (this.disposed) return;
    const dt = this.lastFrame === 0 ? 0 : Math.min((now - this.lastFrame) / 1000, MAX_FRAME_SECONDS);
    this.lastFrame = now;
    this.flyStep(dt);
    const tweening = this.stepFloorTones(dt);
    const moved = this.controls.update();
    if (moved || tweening || this.needsRender) {
      this.needsRender = false;
      this.renderFrame();
      this.emitViewState();
    }
    this.raf = requestAnimationFrame(this.renderLoop);
  };
}
