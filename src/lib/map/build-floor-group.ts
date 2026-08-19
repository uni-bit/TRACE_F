import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";

import { toWorldX, toWorldZ, type PlanTransform } from "./plan-transform";
import type { BuildingFloor } from "./types";

export const LEVEL_HEIGHT = 0.42;
export const WALL_HEIGHT = 0.3;
const SLAB_THICKNESS = 0.03;
const WALL_THICKNESS = 0.045;
const PLAN_LIFT = 0.004;

export interface FloorHandle {
  id: string;
  level: number;
  baseY: number;
  group: THREE.Group;
  slabMaterial: THREE.MeshLambertMaterial;
  planMaterial: THREE.MeshBasicMaterial;
  wallMaterial: THREE.MeshLambertMaterial;
}

/**
 * One floor = slab box + plan-textured plane + all wall segments merged into a
 * single BufferGeometry (one draw call per floor). The plan texture is
 * attached later by the viewer once loaded.
 */
export function buildFloorGroup(floor: BuildingFloor, transform: PlanTransform): FloorHandle {
  const group = new THREE.Group();
  const baseY = (floor.level - 1) * LEVEL_HEIGHT;
  group.position.y = baseY;

  const slabMaterial = new THREE.MeshLambertMaterial({
    color: 0x1e4038,
    transparent: true,
    depthWrite: false,
  });
  const slab = new THREE.Mesh(
    new THREE.BoxGeometry(transform.width, SLAB_THICKNESS, transform.depth),
    slabMaterial,
  );
  slab.position.y = -SLAB_THICKNESS / 2;
  slab.renderOrder = floor.level * 3;
  group.add(slab);

  const planMaterial = new THREE.MeshBasicMaterial({
    color: 0xffffff,
    transparent: true,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -1,
    toneMapped: false,
  });
  const planGeometry = new THREE.PlaneGeometry(transform.width, transform.depth);
  planGeometry.rotateX(-Math.PI / 2);
  const plan = new THREE.Mesh(planGeometry, planMaterial);
  plan.position.y = PLAN_LIFT;
  plan.renderOrder = floor.level * 3 + 1;
  group.add(plan);

  const wallMaterial = new THREE.MeshLambertMaterial({
    color: 0x8de4c4,
    transparent: true,
    depthWrite: false,
  });
  const wallGeometry = mergeWallGeometry(floor, transform);
  if (wallGeometry) {
    const walls = new THREE.Mesh(wallGeometry, wallMaterial);
    walls.renderOrder = floor.level * 3 + 2;
    group.add(walls);
  }

  return { id: floor.id, level: floor.level, baseY, group, slabMaterial, planMaterial, wallMaterial };
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
