import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";

import { buildCoreGeometry, buildFurnitureGeometry } from "./build-features";
import { LEVEL_HEIGHT, toWorldX, toWorldZ, type PlanTransform } from "./plan-transform";
import { rectCovers } from "./rect-utils";
import type { BuildingFloor, NormRect, VoidFeature } from "./types";

const SLAB_THICKNESS = 0.03;
const WALL_THICKNESS = 0.045;
const PLAN_LIFT = 0.004;
/**
 * Derived, never a free number: the wall stands on the plan sheet and stops on
 * the underside of the slab above, so a storey has no daylight gap between the
 * top of its walls and the next floor. A hand-picked value smaller than this
 * is what made every facade read as a stack of loose plates (§11.1).
 */
export const WALL_HEIGHT = LEVEL_HEIGHT - SLAB_THICKNESS - PLAN_LIFT;
/** The footprint outline sits between the slab top (y=0) and the plan texture. */
const EDGE_LIFT = 0.002;

export interface FloorHandle {
  id: string;
  level: number;
  baseY: number;
  group: THREE.Group;
  slabMesh: THREE.Mesh;
  planMesh: THREE.Mesh;
  wallMesh: THREE.Mesh | null;
  outlineMesh: THREE.LineSegments;
  slabMaterial: THREE.MeshLambertMaterial;
  planMaterial: THREE.MeshBasicMaterial;
  wallMaterial: THREE.MeshLambertMaterial;
  outlineMaterial: THREE.LineBasicMaterial;
  /** Null on floors with neither stairs nor escalators. */
  coreMaterial: THREE.MeshLambertMaterial | null;
  coreMesh: THREE.Mesh | null;
  /** Null on floors with neither classrooms nor common areas. */
  furnitureMaterial: THREE.MeshLambertMaterial | null;
  furnitureMesh: THREE.Mesh | null;
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
  const slabMesh = new THREE.Mesh(buildSlabGeometry(footprint, voids, transform), slabMaterial);
  slabMesh.renderOrder = order;
  group.add(slabMesh);

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
  const planMesh = new THREE.Mesh(buildPlanGeometry(footprint, planHoles(floor), transform), planMaterial);
  planMesh.position.y = PLAN_LIFT;
  planMesh.renderOrder = order + 1;
  group.add(planMesh);

  const wallMaterial = new THREE.MeshLambertMaterial({
    color: 0x8de4c4,
    transparent: true,
    depthWrite: false,
  });
  const wallGeometry = mergeWallGeometry(floor, transform, footprint);
  let wallMesh: THREE.Mesh | null = null;
  if (wallGeometry) {
    wallMesh = new THREE.Mesh(wallGeometry, wallMaterial);
    wallMesh.renderOrder = order + 2;
    group.add(wallMesh);
  }

  let coreMaterial: THREE.MeshLambertMaterial | null = null;
  let coreMesh: THREE.Mesh | null = null;
  const coreGeometry = buildCoreGeometry(floor.features, transform);
  if (coreGeometry) {
    coreMaterial = new THREE.MeshLambertMaterial({
      color: 0x8de4c4,
      transparent: true,
      depthWrite: false,
    });
    coreMesh = new THREE.Mesh(coreGeometry, coreMaterial);
    coreMesh.renderOrder = order + 3;
    group.add(coreMesh);
  }

  // Deliberately a separate material from the cores: the furniture is invented
  // and has to be able to fade out well below anything traced from the plan.
  let furnitureMaterial: THREE.MeshLambertMaterial | null = null;
  let furnitureMesh: THREE.Mesh | null = null;
  const furnitureGeometry = buildFurnitureGeometry(floor.features, transform);
  if (furnitureGeometry) {
    furnitureMaterial = new THREE.MeshLambertMaterial({
      color: 0x9fd8c6,
      transparent: true,
      depthWrite: false,
    });
    furnitureMesh = new THREE.Mesh(furnitureGeometry, furnitureMaterial);
    furnitureMesh.renderOrder = order + 3;
    group.add(furnitureMesh);
  }

  const outlineMaterial = new THREE.LineBasicMaterial({
    color: 0x8de4c4,
    transparent: true,
    depthWrite: false,
  });
  // Traces the slab's own edge, which is now the wall's outer face, not the
  // centreline the footprint was measured on.
  const outlineMesh = new THREE.LineSegments(
    buildRingGeometry([slabRing(footprint, transform)]),
    outlineMaterial,
  );
  outlineMesh.renderOrder = order + 4;
  group.add(outlineMesh);

  // No rim line around the openings: a glowing white outline made the void the
  // brightest thing on the floor, i.e. it drew attention to what is NOT there.
  // The slab's own cut edge is the boundary now.

  return {
    id: floor.id,
    level: floor.level,
    baseY,
    group,
    slabMesh,
    planMesh,
    wallMesh,
    outlineMesh,
    slabMaterial,
    planMaterial,
    wallMaterial,
    outlineMaterial,
    coreMaterial,
    coreMesh,
    furnitureMaterial,
    furnitureMesh,
  };
}

/**
 * Everything the plan sheet must not draw: the openings, plus the escalator
 * footprints. The escalator symbol is a bundle of fine parallel lines that
 * reads as noise once there is a real escalator standing on the slab, so the
 * ink comes out and the geometry takes over. The slab keeps its floor there —
 * only the drawing is cut.
 */
function planHoles(floor: BuildingFloor): NormRect[] {
  const holes = floor.features.voids.map((v) => v.rect);
  for (const escalator of floor.features.escalators) {
    // 5F marks its escalator rect as a well as well; two coincident holes
    // would hand ShapeGeometry a degenerate contour.
    if (holes.some((hole) => rectCovers(hole, escalator.rect))) continue;
    holes.push(escalator.rect);
  }
  return holes;
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
/**
 * The footprint is measured on the **wall centreline** (§10.2), so a slab cut
 * to it stops halfway through the wall standing on its edge and the outer half
 * of every perimeter wall — 0.0225 world units, about 20 cm — hangs over
 * nothing. It reads as a ledge of wall with no floor under it, all the way
 * round every floor of every building.
 *
 * So the plate is grown to the wall's outer face before it is extruded. The
 * offset is mitred at each corner and the miter is capped, because a very
 * sharp vertex would otherwise throw a spike far out into the air. The plan
 * sheet is deliberately NOT grown with it: the drawing ends where the drawing
 * ends, and the exposed rim reads as the wall's own thickness.
 */
function offsetPolygon(points: THREE.Vector2[], distance: number): THREE.Vector2[] {
  const n = points.length;
  let area = 0;
  for (let i = 0; i < n; i += 1) {
    const a = points[i];
    const b = points[(i + 1) % n];
    area += a.x * b.y - b.x * a.y;
  }
  // Outward is whichever side the winding says it is.
  const sign = area >= 0 ? 1 : -1;
  const MITER_LIMIT = 4;
  const out: THREE.Vector2[] = [];
  for (let i = 0; i < n; i += 1) {
    const previous = points[(i - 1 + n) % n];
    const current = points[i];
    const next = points[(i + 1) % n];
    const inEdge = new THREE.Vector2(current.x - previous.x, current.y - previous.y);
    const outEdge = new THREE.Vector2(next.x - current.x, next.y - current.y);
    if (inEdge.lengthSq() < 1e-12 || outEdge.lengthSq() < 1e-12) {
      out.push(current.clone());
      continue;
    }
    inEdge.normalize();
    outEdge.normalize();
    // Right-hand normal of each edge, flipped to point out of the polygon.
    const inNormal = new THREE.Vector2(inEdge.y, -inEdge.x).multiplyScalar(sign);
    const outNormal = new THREE.Vector2(outEdge.y, -outEdge.x).multiplyScalar(sign);
    const bisector = inNormal.clone().add(outNormal);
    if (bisector.lengthSq() < 1e-12) {
      out.push(current.clone().addScaledVector(inNormal, distance));
      continue;
    }
    bisector.normalize();
    const cos = bisector.dot(inNormal);
    const scale = Math.min(distance / Math.max(cos, 1e-6), distance * MITER_LIMIT);
    out.push(current.clone().addScaledVector(bisector, scale));
  }
  return out;
}

function slabRing(footprint: [number, number][], transform: PlanTransform): THREE.Vector2[] {
  return offsetPolygon(
    footprint.map(([nx, nz]) => new THREE.Vector2(toWorldX(nx, transform), toWorldZ(nz, transform))),
    WALL_THICKNESS / 2,
  );
}

function buildSlabGeometry(
  footprint: [number, number][],
  voids: VoidFeature[],
  transform: PlanTransform,
): THREE.BufferGeometry {
  const shape = new THREE.Shape(slabRing(footprint, transform));
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
 * The plan texture on a footprint-shaped sheet with `holes` cut out — NOT a
 * full-rect plane. If the ink kept drawing across the openings, the chain-line
 * X symbols would float over the holes and a void would read as "floor with an
 * X on it" while real floor reads as nothing: exactly backwards. Clipping the
 * sheet makes a void truly empty and leaves the slab as the only "there is
 * floor here" signal.
 */
function buildPlanGeometry(
  footprint: [number, number][],
  holes: NormRect[],
  transform: PlanTransform,
): THREE.BufferGeometry {
  const shape = new THREE.Shape(
    footprint.map(([nx, nz]) => new THREE.Vector2(toWorldX(nx, transform), toWorldZ(nz, transform))),
  );
  for (const rect of holes) {
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
function buildRingGeometry(rings: THREE.Vector2[][]): THREE.BufferGeometry {
  const positions: number[] = [];
  for (const ring of rings) {
    for (let i = 0; i < ring.length; i += 1) {
      const a = ring[i];
      const b = ring[(i + 1) % ring.length];
      positions.push(a.x, EDGE_LIFT, a.y);
      positions.push(b.x, EDGE_LIFT, b.y);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  return geometry;
}

function mergeWallGeometry(
  floor: BuildingFloor,
  transform: PlanTransform,
  footprint: [number, number][],
): THREE.BufferGeometry | null {
  // The wall extractor sees every cyan line inside the master rectangle. A
  // rectangle can intentionally contain neighbouring structures, so never
  // let a wall survive solely because it was inside the crop: walls must sit
  // on the same PDF-derived slab outline as the plan and texture.
  const boxes = floor.walls.flatMap(([x1, z1, x2, z2]) =>
    clipSegmentToPolygon(x1, z1, x2, z2, footprint),
  ).map(([x1, z1, x2, z2]) => {
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

/**
 * Keep the portion of a wall that is actually on the slab. A midpoint-only
 * test drops a perfectly valid perimeter wall whenever its centre lies just
 * outside a concave footprint; that is the source of the missing wall ends
 * visible on several connector and high-floor plans.
 */
function clipSegmentToPolygon(
  x1: number,
  z1: number,
  x2: number,
  z2: number,
  polygon: [number, number][],
): [number, number, number, number][] {
  const values = [0, 1];
  const dx = x2 - x1;
  const dz = z2 - z1;
  for (let i = 0; i < polygon.length; i += 1) {
    const [ax, az] = polygon[i];
    const [bx, bz] = polygon[(i + 1) % polygon.length];
    const ex = bx - ax;
    const ez = bz - az;
    const denominator = dx * ez - dz * ex;
    if (Math.abs(denominator) < 1e-9) continue;
    const t = ((ax - x1) * ez - (az - z1) * ex) / denominator;
    const u = ((ax - x1) * dz - (az - z1) * dx) / denominator;
    if (t > 1e-7 && t < 1 - 1e-7 && u >= -1e-7 && u <= 1 + 1e-7) values.push(t);
  }
  values.sort((a, b) => a - b);
  const clipped: [number, number, number, number][] = [];
  for (let i = 0; i < values.length - 1; i += 1) {
    const start = values[i];
    const end = values[i + 1];
    if (end - start < 1e-7) continue;
    const middle = (start + end) / 2;
    if (!pointInPolygon(x1 + dx * middle, z1 + dz * middle, polygon)) continue;
    clipped.push([
      x1 + dx * start,
      z1 + dz * start,
      x1 + dx * end,
      z1 + dz * end,
    ]);
  }
  return clipped;
}

function pointInPolygon(x: number, z: number, polygon: [number, number][]): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [ax, az] = polygon[i];
    const [bx, bz] = polygon[j];
    const cross = (x - ax) * (bz - az) - (z - az) * (bx - ax);
    const onSegment =
      Math.abs(cross) < 1e-7 &&
      x >= Math.min(ax, bx) - 1e-7 &&
      x <= Math.max(ax, bx) + 1e-7 &&
      z >= Math.min(az, bz) - 1e-7 &&
      z <= Math.max(az, bz) + 1e-7;
    if (onSegment) return true;
    if ((az > z) !== (bz > z) && x < ((bx - ax) * (z - az)) / (bz - az) + ax) {
      inside = !inside;
    }
  }
  return inside;
}
