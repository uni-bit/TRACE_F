import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";

import { buildElevatorShaft } from "./build-features";
import { buildFloorGroup, type FloorHandle } from "./build-floor-group";
import { footprintFor } from "./buildings";
import { LEVEL_HEIGHT, planTransform, type PlanTransform } from "./plan-transform";
import type { BuildingDefinition, CameraMode } from "./types";

// The slab tracks the walls one notch below them everywhere: the floor has to
// read as a solid object (a void is where that object stops), while the walls
// stay the strongest thing standing on it.
const OPACITY = {
  selected: { plan: 1, wall: 0.85, slab: 0.72, outline: 0.55, core: 0.45, furniture: 0.15 },
  dimmed: { plan: 0.06, wall: 0.05, slab: 0.04, outline: 0.05, core: 0.04, furniture: 0.02 },
  all: { plan: 0.65, wall: 0.4, slab: 0.34, outline: 0.35, core: 0.25, furniture: 0.1 },
} as const;
/** The shafts read the same whatever floor is picked — they are the skewer. */
const SHAFT_OPACITY = { solid: 0.12, edges: 0.3 } as const;
const SELECTED_LIFT = 0.09;
const MAX_PIXEL_RATIO = 2;
const BACKGROUND = 0x0b1420;
const FOG_DENSITY = 0.035;
const GROUND_Y = -0.6;
const GROUND_TEXTURE_SIZE = 2048;
const GROUND_GRID_PITCH = 64;
/** Frame-rate independent: 60Hz and 120Hz reach the target in the same time. */
const TONE_TAU = 0.12;
const TONE_EPSILON = 1e-3;

const WORLD_UP = new THREE.Vector3(0, 1, 0);
const FLY_KEYS = new Set(["KeyW", "KeyA", "KeyS", "KeyD", "KeyQ", "KeyE", "ShiftLeft", "ShiftRight"]);
const FLY_SPEED = 2.2;
const FLY_BOOST = 3;
/** Long frames (a backgrounded tab) must not teleport the camera. */
const MAX_FRAME_SECONDS = 0.05;

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
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
  private readonly structureGroup: THREE.Group;
  private readonly pressed = new Set<string>();
  private readonly composer: EffectComposer | null;
  private readonly bloomPass: UnrealBloomPass | null;
  private readonly renderTarget: THREE.WebGLRenderTarget | null;
  private readonly toneTarget: FloorTone[] = [];
  private readonly toneCurrent: FloorTone[] = [];
  private lastFrame = 0;
  private readonly resizeObserver: ResizeObserver;
  private readonly buildingHeight: number;
  private raf = 0;
  private needsRender = true;
  private disposed = false;
  private selectedFloorId: string | null = null;
  private debugStack = false;

  constructor(container: HTMLElement, building: BuildingDefinition, effects = true) {
    this.container = container;
    this.transform = planTransform(building.plan);
    this.buildingHeight = building.floors.length * LEVEL_HEIGHT;

    // Opaque, unlike v1: EffectComposer does not compose over a transparent
    // clear, so the background moves into the scene and the CSS gradient stays
    // only as a pre-first-frame fallback.
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.15;
    this.renderer.domElement.className = "campus-3d-canvas";
    container.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(BACKGROUND);
    this.scene.fog = new THREE.FogExp2(BACKGROUND, FOG_DENSITY);
    this.scene.add(new THREE.HemisphereLight(0xbfd8ff, 0x1a2030, 0.95));
    const sun = new THREE.DirectionalLight(0xffffff, 0.65);
    sun.position.set(5, 10, 4);
    this.scene.add(sun);

    const groundTexture = createGroundTexture();
    if (groundTexture) {
      this.textures.push(groundTexture);
      const groundGeometry = new THREE.PlaneGeometry(
        this.transform.width * 6,
        this.transform.depth * 6,
      );
      groundGeometry.rotateX(-Math.PI / 2);
      // FrontSide on purpose: flying below it with Q must not black out the view.
      const ground = new THREE.Mesh(
        groundGeometry,
        new THREE.MeshBasicMaterial({ map: groundTexture, fog: true, depthWrite: false }),
      );
      ground.position.y = GROUND_Y;
      ground.renderOrder = -1;
      this.scene.add(ground);
    }

    this.camera = new THREE.PerspectiveCamera(45, 1, 0.1, 120);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.minDistance = 3.5;
    this.controls.maxDistance = 30;
    this.controls.maxPolarAngle = 1.35;
    this.controls.addEventListener("change", () => {
      this.needsRender = true;
    });

    const loader = new THREE.TextureLoader();
    const maxAnisotropy = this.renderer.capabilities.getMaxAnisotropy();
    const topLevel = Math.max(...building.floors.map((f) => f.level));
    this.floors = building.floors.map((floor) => {
      const handle = buildFloorGroup(
        floor,
        this.transform,
        footprintFor(building, floor.id),
        floor.level === topLevel,
      );
      this.scene.add(handle.group);
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
    this.structureGroup = new THREE.Group();
    this.scene.add(this.structureGroup);
    const shaftSolid = new THREE.MeshLambertMaterial({
      color: 0x8de4c4,
      transparent: true,
      opacity: SHAFT_OPACITY.solid,
      depthWrite: false,
    });
    const shaftEdges = new THREE.LineBasicMaterial({
      color: 0xd8fff0,
      transparent: true,
      opacity: SHAFT_OPACITY.edges,
      depthWrite: false,
    });
    for (const shaft of building.features.elevators) {
      const { solid, edges } = buildElevatorShaft(shaft, this.transform);
      const column = new THREE.Mesh(solid, shaftSolid);
      column.renderOrder = 100;
      const wires = new THREE.LineSegments(edges, shaftEdges);
      wires.renderOrder = 100;
      this.structureGroup.add(column, wires);
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

  setSelectedFloor(id: string | null): void {
    this.selectedFloorId = id;
    this.applyFloorAppearance();
  }

  setCameraMode(mode: CameraMode): void {
    const target = new THREE.Vector3(0, this.buildingHeight * 0.35, 0);
    if (mode === "north") {
      target.set(0, 0, 0);
      this.camera.position.set(0, this.buildingHeight + this.transform.depth * 1.15, 0.001);
    } else {
      this.camera.position.set(
        this.transform.width * 1.15,
        this.buildingHeight * 2.4,
        this.transform.depth * 0.95,
      );
    }
    this.controls.target.copy(target);
    this.controls.update();
    this.needsRender = true;
  }

  /** Development aid: collapse every floor onto y=0 to eyeball registration. */
  setDebugStack(on: boolean): void {
    this.debugStack = on;
    // A shaft spanning six storeys is meaningless once they all sit on y=0.
    this.structureGroup.visible = !on;
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
    this.floors.forEach((floor, i) => {
      const selected = this.selectedFloorId === floor.id;
      const tone =
        this.selectedFloorId === null ? OPACITY.all : selected ? OPACITY.selected : OPACITY.dimmed;
      this.toneTarget[i] = {
        ...tone,
        lift: this.debugStack ? 0 : floor.baseY + (selected ? SELECTED_LIFT : 0),
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
      if (floor.coreMaterial) floor.coreMaterial.opacity = tone.core;
      if (floor.furnitureMaterial) floor.furnitureMaterial.opacity = tone.furniture;
      floor.group.position.y = tone.lift;
    });
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
      // is the top of the viewport, which in NORTH is plan north.
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
    target.x = clamp(target.x, -this.transform.width * 2, this.transform.width * 2);
    target.z = clamp(target.z, -this.transform.depth * 2, this.transform.depth * 2);
    target.y = clamp(target.y, -1, this.buildingHeight + 8);
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
    }
    this.raf = requestAnimationFrame(this.renderLoop);
  };
}
