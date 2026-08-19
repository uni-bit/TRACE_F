import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";

import { buildElevatorShaft } from "./build-features";
import { buildFloorGroup, type FloorHandle } from "./build-floor-group";
import { footprintFor } from "./buildings";
import { LEVEL_HEIGHT, planTransform, type PlanTransform } from "./plan-transform";
import type { BuildingDefinition, CameraMode } from "./types";

const OPACITY = {
  selected: { plan: 1, wall: 0.85, slab: 0.32, outline: 0.55, voidEdge: 1, core: 0.45 },
  dimmed: { plan: 0.06, wall: 0.05, slab: 0.06, outline: 0.05, voidEdge: 0.06, core: 0.04 },
  all: { plan: 0.65, wall: 0.4, slab: 0.18, outline: 0.35, voidEdge: 0.6, core: 0.25 },
} as const;
/** The shafts read the same whatever floor is picked — they are the skewer. */
const SHAFT_OPACITY = { solid: 0.12, edges: 0.3 } as const;
const SELECTED_LIFT = 0.09;
const MAX_PIXEL_RATIO = 2;

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
  private readonly resizeObserver: ResizeObserver;
  private readonly buildingHeight: number;
  private raf = 0;
  private needsRender = true;
  private disposed = false;
  private selectedFloorId: string | null = null;
  private debugStack = false;

  constructor(container: HTMLElement, building: BuildingDefinition) {
    this.container = container;
    this.transform = planTransform(building.plan);
    this.buildingHeight = building.floors.length * LEVEL_HEIGHT;

    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.domElement.className = "campus-3d-canvas";
    container.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    this.scene.add(new THREE.HemisphereLight(0xbfd8ff, 0x1a2030, 0.95));
    const sun = new THREE.DirectionalLight(0xffffff, 0.65);
    sun.position.set(5, 10, 4);
    this.scene.add(sun);

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

    this.applyFloorAppearance();

    this.setCameraMode("orbit");
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
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }

  private applyFloorAppearance(): void {
    for (const floor of this.floors) {
      const selected = this.selectedFloorId === floor.id;
      const tone =
        this.selectedFloorId === null ? OPACITY.all : selected ? OPACITY.selected : OPACITY.dimmed;
      floor.planMaterial.opacity = tone.plan;
      floor.wallMaterial.opacity = tone.wall;
      floor.slabMaterial.opacity = tone.slab;
      floor.outlineMaterial.opacity = tone.outline;
      if (floor.voidEdgeMaterial) floor.voidEdgeMaterial.opacity = tone.voidEdge;
      if (floor.coreMaterial) floor.coreMaterial.opacity = tone.core;
      floor.group.position.y = this.debugStack ? 0 : floor.baseY + (selected ? SELECTED_LIFT : 0);
    }
    this.needsRender = true;
  }

  private resize(): void {
    const width = this.container.clientWidth;
    const height = this.container.clientHeight;
    if (width === 0 || height === 0) return;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, MAX_PIXEL_RATIO));
    this.renderer.setSize(width, height);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.needsRender = true;
  }

  private readonly renderLoop = (): void => {
    if (this.disposed) return;
    const moved = this.controls.update();
    if (moved || this.needsRender) {
      this.needsRender = false;
      this.renderer.render(this.scene, this.camera);
    }
    this.raf = requestAnimationFrame(this.renderLoop);
  };
}
