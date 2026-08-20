import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";

import { buildCoreGeometry, buildFurnitureGeometry } from "./build-features";
import { LEVEL_HEIGHT, toWorldX, toWorldZ, type PlanTransform } from "./plan-transform";
import type { BuildingFloor, NormRect, VoidFeature } from "./types";

export const WALL_HEIGHT = 0.3;
const SLAB_THICKNESS = 0.03;
const WALL_THICKNESS = 0.045;
const PLAN_LIFT = 0.004;
/** The footprint outline sits between the slab top (y=0) and the plan texture. */
const EDGE_LIFT = 0.002;

export interface FloorHandle {
  id: string;
  level: number;
  baseY: number;
  group: THREE.Group;
  slabMaterial: THREE.MeshLambertMaterial;
  planMaterial: THREE.MeshBasicMaterial;
  wallMaterial: THREE.MeshLambertMaterial;
  outlineMaterial: THREE.LineBasicMaterial;
  /** Null on the top floor, whose stairs and escalators lead nowhere. */
  coreMaterial: THREE.MeshLambertMaterial | null;
  /** Null on floors with neither classrooms nor common areas. */
  furnitureMaterial: THREE.MeshLambertMaterial | null;
}

/**
 * One floor = footprint slab with the atria punched out, plan-textured plane,
 * every wall segment merged into a single BufferGeometry, plus the footprint
 * outline as line work. The plan texture is attached later by the viewer once
 * loaded.
 *
 * renderOrder is layered per level (§11.4): base = level * 10, then
 * +0 slab / +1 plan / +2 walls / +3 cores and furniture / +4 line work.
 */
export function buildFloorGroup(
  floor: BuildingFloor,
  transform: PlanTransform,
  footprint: [number, number][],
  isTopFloor: boolean,
): FloorHandle {
  const group = new THREE.Group();
  const baseY = (floor.level - 1) * LEVEL_HEIGHT;
  group.position.y = baseY;
  const order = floor.level * 10;
  const voids = floor.features.voids;

  // A panel, not a tint. The slab is the only thing that says "there is floor
  // here", so it is lit in the same mint as the walls and sits just under them
  // in weight (§11.1): read the plate first, the walls standing on it second,
  // and a void as the plate simply not being there.
  const slabMaterial = new THREE.MeshLambertMaterial({
    color: 0x6ecfae,
    emissive: 0x16463b,
    transparent: true,
    depthWrite: false,
  });
  const slab = new THREE.Mesh(buildSlabGeometry(footprint, voids, transform), slabMaterial);
  slab.renderOrder = order;
  group.add(slab);

  const planMaterial = new THREE.MeshBasicMaterial({
    color: 0xffffff,
    transparent: true,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -1,
    toneMapped: false,
    side: THREE.DoubleSide,
  });
  const plan = new THREE.Mesh(buildPlanGeometry(footprint, voids, transform), planMaterial);
  plan.position.y = PLAN_LIFT;
  plan.renderOrder = order + 1;
  group.add(plan);

  const wallMaterial = new THREE.MeshLambertMaterial({
    color: 0x8de4c4,
    transparent: true,
    depthWrite: false,
  });
  const wallGeometry = mergeWallGeometry(floor, transform);
  if (wallGeometry) {
    const walls = new THREE.Mesh(wallGeometry, wallMaterial);
    walls.renderOrder = order + 2;
    group.add(walls);
  }

  let coreMaterial: THREE.MeshLambertMaterial | null = null;
  const coreGeometry = buildCoreGeometry(floor.features, transform, isTopFloor);
  if (coreGeometry) {
    coreMaterial = new THREE.MeshLambertMaterial({
      color: 0x8de4c4,
      transparent: true,
      depthWrite: false,
    });
    const cores = new THREE.Mesh(coreGeometry, coreMaterial);
    cores.renderOrder = order + 3;
    group.add(cores);
  }

  // Deliberately a separate material from the cores: the furniture is invented
  // and has to be able to fade out well below anything traced from the plan.
  let furnitureMaterial: THREE.MeshLambertMaterial | null = null;
  const furnitureGeometry = buildFurnitureGeometry(floor.features, transform);
  if (furnitureGeometry) {
    furnitureMaterial = new THREE.MeshLambertMaterial({
      color: 0x9fd8c6,
      transparent: true,
      depthWrite: false,
    });
    const furniture = new THREE.Mesh(furnitureGeometry, furnitureMaterial);
    furniture.renderOrder = order + 3;
    group.add(furniture);
  }

  const outlineMaterial = new THREE.LineBasicMaterial({
    color: 0x8de4c4,
    transparent: true,
    depthWrite: false,
  });
  const outline = new THREE.LineSegments(buildRingGeometry([footprint], transform), outlineMaterial);
  outline.renderOrder = order + 4;
  group.add(outline);

  // No rim line around the openings: a glowing white outline made the void the
  // brightest thing on the floor, i.e. it drew attention to what is NOT there.
  // The slab's own cut edge is the boundary now.

  return {
    id: floor.id,
    level: floor.level,
    baseY,
    group,
    slabMaterial,
    planMaterial,
    wallMaterial,
    outlineMaterial,
    coreMaterial,
    furnitureMaterial,
  };
}

function rectRing(rect: NormRect): [number, number][] {
  return [
    [rect.x0, rect.z0],
    [rect.x1, rect.z0],
    [rect.x1, rect.z1],
    [rect.x0, rect.z1],
  ];
}

/**
 * THREE.Shape lives in XY and extrudes along +Z. rotateX(+PI/2) maps
 * (x, y, 0) -> (x, 0, y) and the extrusion +z -> -y, so the plan y becomes
 * world z (+z = plan down, same sign as v1) and the slab occupies
 * y in [-SLAB_THICKNESS, 0] with no extra translation. Hole winding does not
 * matter: ExtrudeGeometry normalizes it against the contour.
 */
function buildSlabGeometry(
  footprint: [number, number][],
  voids: VoidFeature[],
  transform: PlanTransform,
): THREE.BufferGeometry {
  const shape = new THREE.Shape(
    footprint.map(([nx, nz]) => new THREE.Vector2(toWorldX(nx, transform), toWorldZ(nz, transform))),
  );
  for (const { rect } of voids) {
    shape.holes.push(
      new THREE.Path(
        rectRing(rect).map(([nx, nz]) => new THREE.Vector2(toWorldX(nx, transform), toWorldZ(nz, transform))),
      ),
    );
  }
  const geometry = new THREE.ExtrudeGeometry(shape, { depth: SLAB_THICKNESS, bevelEnabled: false });
  geometry.rotateX(Math.PI / 2);
  return geometry;
}

/**
 * The plan texture on a footprint-shaped sheet with the voids cut out — NOT a
 * full-rect plane. If the ink kept drawing across the openings, the chain-line
 * X symbols would float over the holes and a void would read as "floor with an
 * X on it" while real floor reads as nothing: exactly backwards. Clipping the
 * sheet makes a void truly empty and leaves the slab as the only "there is
 * floor here" signal.
 */
function buildPlanGeometry(
  footprint: [number, number][],
  voids: VoidFeature[],
  transform: PlanTransform,
): THREE.BufferGeometry {
  const shape = new THREE.Shape(
    footprint.map(([nx, nz]) => new THREE.Vector2(toWorldX(nx, transform), toWorldZ(nz, transform))),
  );
  for (const { rect } of voids) {
    shape.holes.push(
      new THREE.Path(
        rectRing(rect).map(([nx, nz]) => new THREE.Vector2(toWorldX(nx, transform), toWorldZ(nz, transform))),
      ),
    );
  }
  const geometry = new THREE.ShapeGeometry(shape);
  // The shape lives in world XZ (pre-rotation XY); map vertices straight into
  // the master-rect texture. v=1 is the image top row (three flips Y), which
  // is plan north (-z), matching the old full-rect plane exactly.
  const positions = geometry.getAttribute("position");
  const uv = new Float32Array(positions.count * 2);
  for (let i = 0; i < positions.count; i += 1) {
    uv[i * 2] = positions.getX(i) / transform.width + 0.5;
    uv[i * 2 + 1] = 0.5 - positions.getY(i) / transform.depth;
  }
  geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  geometry.rotateX(Math.PI / 2);
  return geometry;
}

/**
 * Closed rings -> LineSegments, built straight from the annotation polylines.
 * EdgesGeometry(slab) is not usable here: it leaks triangulation diagonals and
 * the extrusion side edges into the line work (§11.2).
 */
function buildRingGeometry(rings: [number, number][][], transform: PlanTransform): THREE.BufferGeometry {
  const positions: number[] = [];
  for (const ring of rings) {
    for (let i = 0; i < ring.length; i += 1) {
      const [ax, az] = ring[i];
      const [bx, bz] = ring[(i + 1) % ring.length];
      positions.push(toWorldX(ax, transform), EDGE_LIFT, toWorldZ(az, transform));
      positions.push(toWorldX(bx, transform), EDGE_LIFT, toWorldZ(bz, transform));
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  return geometry;
}

function mergeWallGeometry(floor: BuildingFloor, transform: PlanTransform): THREE.BufferGeometry | null {
  const boxes = floor.walls.map(([x1, z1, x2, z2]) => {
    const spanX = Math.abs(toWorldX(x2 - x1, transform));
    const spanZ = Math.abs(toWorldZ(z2 - z1, transform));
    const box = new THREE.BoxGeometry(
      Math.max(spanX, WALL_THICKNESS),
      WALL_HEIGHT,
      Math.max(spanZ, WALL_THICKNESS),
    );
    box.translate(
      toWorldX((x1 + x2) / 2, transform),
      WALL_HEIGHT / 2 + PLAN_LIFT,
      toWorldZ((z1 + z2) / 2, transform),
    );
    return box;
  });
  if (boxes.length === 0) return null;
  const merged = mergeGeometries(boxes);
  for (const box of boxes) box.dispose();
  return merged;
}
