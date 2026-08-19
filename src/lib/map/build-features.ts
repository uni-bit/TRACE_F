import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";

import { LEVEL_HEIGHT, toWorldX, toWorldZ, type PlanTransform } from "./plan-transform";
import type { ElevatorShaft, FloorFeatures, NormRect, PlanAxis } from "./types";

/** The plan hatching only ever draws one flight, so we only build one (§12.1). */
const STEPS = 12;
const ESCALATOR_DECK = 0.02;
const ESCALATOR_RAIL_HEIGHT = 0.05;
const ESCALATOR_RAIL_THICKNESS = 0.012;

interface WorldRect {
  x0: number;
  x1: number;
  z0: number;
  z1: number;
}

function toWorldRect(rect: NormRect, transform: PlanTransform): WorldRect {
  return {
    x0: toWorldX(rect.x0, transform),
    x1: toWorldX(rect.x1, transform),
    z0: toWorldZ(rect.z0, transform),
    z1: toWorldZ(rect.z1, transform),
  };
}

const RUNS_ALONG_X = (up: PlanAxis) => up === "+x" || up === "-x";
/** True when the axis points at the far (max) end of the rect. */
const ASCENDS_TOWARD_MAX = (up: PlanAxis) => up === "+x" || up === "+z";

/**
 * Stairs and escalators for one floor, merged into a single BufferGeometry so a
 * floor never costs more than one draw call for its vertical circulation.
 * Returns null on the top floor: both reach the storey above, and there is none.
 */
export function buildCoreGeometry(
  features: FloorFeatures,
  transform: PlanTransform,
  isTopFloor: boolean,
): THREE.BufferGeometry | null {
  if (isTopFloor) return null;

  const parts: THREE.BufferGeometry[] = [];
  for (const stair of features.stairs) {
    parts.push(...stairSteps(toWorldRect(stair.rect, transform), stair.up));
  }
  for (const escalator of features.escalators) {
    parts.push(...escalatorLanes(toWorldRect(escalator.rect, transform), escalator.up, escalator.lanes));
  }
  if (parts.length === 0) return null;
  const merged = mergeGeometries(parts);
  for (const part of parts) part.dispose();
  return merged;
}

/**
 * The rect is cut into STEPS treads along the axis of ascent; tread i is a box
 * of height (i+1) * LEVEL_HEIGHT / STEPS sitting on y=0, so the flight climbs
 * from this floor's slab to the one above.
 */
function stairSteps(rect: WorldRect, up: PlanAxis): THREE.BufferGeometry[] {
  const alongX = RUNS_ALONG_X(up);
  const spanX = rect.x1 - rect.x0;
  const spanZ = rect.z1 - rect.z0;
  const tread = (alongX ? spanX : spanZ) / STEPS;
  const boxes: THREE.BufferGeometry[] = [];
  for (let i = 0; i < STEPS; i += 1) {
    const height = ((i + 1) * LEVEL_HEIGHT) / STEPS;
    const slot = ASCENDS_TOWARD_MAX(up) ? i : STEPS - 1 - i;
    const box = new THREE.BoxGeometry(
      alongX ? tread : spanX,
      height,
      alongX ? spanZ : tread,
    );
    box.translate(
      alongX ? rect.x0 + tread * (slot + 0.5) : (rect.x0 + rect.x1) / 2,
      height / 2,
      alongX ? (rect.z0 + rect.z1) / 2 : rect.z0 + tread * (slot + 0.5),
    );
    boxes.push(box);
  }
  return boxes;
}

/**
 * One inclined deck plus two rails per lane. Up and down escalators are the
 * same solid, so a single lane is built and translated across the rect; the
 * arrows on the plan texture already say which way each one runs (§12.2).
 *
 * The pitch comes from the exaggerated storey height, not from the real 30 deg
 * — this is a guide, not a survey (§18).
 */
function escalatorLanes(rect: WorldRect, up: PlanAxis, lanes: number): THREE.BufferGeometry[] {
  const alongX = RUNS_ALONG_X(up);
  const run = alongX ? rect.x1 - rect.x0 : rect.z1 - rect.z0;
  const acrossSpan = alongX ? rect.z1 - rect.z0 : rect.x1 - rect.x0;
  const acrossStart = alongX ? rect.z0 : rect.x0;
  const laneSpan = acrossSpan / lanes;
  const alongCentre = alongX ? (rect.x0 + rect.x1) / 2 : (rect.z0 + rect.z1) / 2;

  // length * sin(pitch) === LEVEL_HEIGHT, so a box rotated about its centre
  // spans exactly one storey and lands on [0, LEVEL_HEIGHT] after the lift.
  const length = Math.hypot(run, LEVEL_HEIGHT);
  const pitch = Math.atan2(LEVEL_HEIGHT, run);
  const towardMax = ASCENDS_TOWARD_MAX(up);
  // rotateZ(+p) raises the +x end; rotateX(+p) lowers the +z end.
  const tilt = alongX ? (towardMax ? pitch : -pitch) : (towardMax ? -pitch : pitch);

  const parts: THREE.BufferGeometry[] = [];
  const plank = (acrossWidth: number, height: number, acrossPos: number, lift: number) => {
    const box = new THREE.BoxGeometry(
      alongX ? length : acrossWidth,
      height,
      alongX ? acrossWidth : length,
    );
    if (alongX) box.rotateZ(tilt);
    else box.rotateX(tilt);
    box.translate(
      alongX ? alongCentre : acrossPos,
      LEVEL_HEIGHT / 2 + lift,
      alongX ? acrossPos : alongCentre,
    );
    parts.push(box);
  };

  const railLift = (ESCALATOR_DECK + ESCALATOR_RAIL_HEIGHT) / 2;
  for (let lane = 0; lane < lanes; lane += 1) {
    const centre = acrossStart + laneSpan * (lane + 0.5);
    plank(laneSpan * 0.86, ESCALATOR_DECK, centre, 0);
    plank(ESCALATOR_RAIL_THICKNESS, ESCALATOR_RAIL_HEIGHT, centre - laneSpan * 0.43, railLift);
    plank(ESCALATOR_RAIL_THICKNESS, ESCALATOR_RAIL_HEIGHT, centre + laneSpan * 0.43, railLift);
  }
  return parts;
}

/**
 * The only building-level element: a glass column from the bottom of its lowest
 * floor to the ceiling of its highest, plus the four vertical corner lines. It
 * lives outside the floor groups because those move for selection lift and
 * debugStack, and a shaft that skewers the stack must not move with them.
 */
export function buildElevatorShaft(
  shaft: ElevatorShaft,
  transform: PlanTransform,
): { solid: THREE.BufferGeometry; edges: THREE.BufferGeometry } {
  const rect = toWorldRect(shaft.rect, transform);
  const bottom = (shaft.levels[0] - 1) * LEVEL_HEIGHT;
  const top = shaft.levels[1] * LEVEL_HEIGHT;

  const solid = new THREE.BoxGeometry(rect.x1 - rect.x0, top - bottom, rect.z1 - rect.z0);
  solid.translate((rect.x0 + rect.x1) / 2, (bottom + top) / 2, (rect.z0 + rect.z1) / 2);

  const corners: [number, number][] = [
    [rect.x0, rect.z0],
    [rect.x1, rect.z0],
    [rect.x1, rect.z1],
    [rect.x0, rect.z1],
  ];
  const positions: number[] = [];
  for (const [x, z] of corners) positions.push(x, bottom, z, x, top, z);
  const edges = new THREE.BufferGeometry();
  edges.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));

  return { solid, edges };
}
