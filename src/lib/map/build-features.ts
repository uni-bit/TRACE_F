import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";

import { LEVEL_HEIGHT, toWorldX, toWorldZ, type PlanTransform } from "./plan-transform";
import type { CommonArea, ElevatorShaft, FloorFeatures, NormRect, PlanAxis } from "./types";

/** The plan hatching only ever draws one flight, so we only build one (§12.1). */
const STEPS = 12;
const ESCALATOR_DECK = 0.02;
const ESCALATOR_RAIL_HEIGHT = 0.05;
const ESCALATOR_RAIL_THICKNESS = 0.012;

const WHITEBOARD_SPAN = 0.6;
const WHITEBOARD_HEIGHT = 0.12;
const WHITEBOARD_THICKNESS = 0.012;
const WHITEBOARD_BASE = 0.06;
/** Clear of the wall it hangs on. */
const WHITEBOARD_INSET = 0.05;

const DESK_MARGIN = 0.15;
const DESK_PITCH_X = 0.145;
const DESK_PITCH_Z = 0.105;
const DESK_SIZE_X = 0.09;
const DESK_SIZE_Z = 0.05;
const DESK_HEIGHT = 0.035;
const DESK_MAX_COLS = 8;
const DESK_MAX_ROWS = 10;

const BENCH_LENGTH = 0.06;
const BENCH_DEPTH = 0.03;
const BENCH_HEIGHT = 0.03;
const PLANTER_RADIUS = 0.016;
const PLANTER_HEIGHT = 0.05;
const TABLE_RADIUS = 0.035;
const TABLE_HEIGHT = 0.03;
const CORRIDOR_PITCH = 0.5;
const HALL_PITCH = 0.35;
const COMMON_EDGE_INSET = 0.05;
/** Below this across-span a corridor gets objects on one edge only. */
const NARROW_LANE = 0.12;

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

/** The rect axis a PlanAxis refers to, and which end of it the axis points at. */
const IS_X_AXIS = (axis: PlanAxis) => axis === "+x" || axis === "-x";
const POINTS_AT_MAX = (axis: PlanAxis) => axis === "+x" || axis === "+z";

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
  const alongX = IS_X_AXIS(up);
  const spanX = rect.x1 - rect.x0;
  const spanZ = rect.z1 - rect.z0;
  const tread = (alongX ? spanX : spanZ) / STEPS;
  const boxes: THREE.BufferGeometry[] = [];
  for (let i = 0; i < STEPS; i += 1) {
    const height = ((i + 1) * LEVEL_HEIGHT) / STEPS;
    const slot = POINTS_AT_MAX(up) ? i : STEPS - 1 - i;
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
  const alongX = IS_X_AXIS(up);
  const run = alongX ? rect.x1 - rect.x0 : rect.z1 - rect.z0;
  const acrossSpan = alongX ? rect.z1 - rect.z0 : rect.x1 - rect.x0;
  const acrossStart = alongX ? rect.z0 : rect.x0;
  const laneSpan = acrossSpan / lanes;
  const alongCentre = alongX ? (rect.x0 + rect.x1) / 2 : (rect.z0 + rect.z1) / 2;

  // length * sin(pitch) === LEVEL_HEIGHT, so a box rotated about its centre
  // spans exactly one storey and lands on [0, LEVEL_HEIGHT] after the lift.
  const length = Math.hypot(run, LEVEL_HEIGHT);
  const pitch = Math.atan2(LEVEL_HEIGHT, run);
  const towardMax = POINTS_AT_MAX(up);
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

/**
 * Desks, whiteboards, and common-area objects for a floor, merged into one
 * geometry. This is schematic furniture, not a seating plan: the classroom
 * desks give the rooms a sense of scale, and the corridor benches / hall
 * tables mark walkable slab so it can never be misread as a void (§13, and
 * the inspector copy says so).
 */
export function buildFurnitureGeometry(
  features: FloorFeatures,
  transform: PlanTransform,
): THREE.BufferGeometry | null {
  const parts: THREE.BufferGeometry[] = [];
  for (const band of features.classrooms) {
    for (const [z0, z1] of band.rows) {
      const room = toWorldRect({ x0: band.x[0], x1: band.x[1], z0, z1 }, transform);
      parts.push(whiteboard(room, band.facing), ...desks(room));
    }
  }
  for (const area of features.commons) {
    parts.push(...commonObjects(area, transform));
  }
  if (parts.length === 0) return null;
  const merged = mergeGeometries(parts);
  for (const part of parts) part.dispose();
  return merged;
}

/**
 * Deterministic layouts on purpose — a scatter that reshuffles on every page
 * load would read as noise, not as a building. Corridors alternate benches and
 * planters along both edges (walking lane kept clear); halls get round tables
 * on a checkerboard with planters in the corners.
 */
function commonObjects(area: CommonArea, transform: PlanTransform): THREE.BufferGeometry[] {
  const rect = toWorldRect(area.rect, transform);
  return area.kind === "corridor" ? corridorObjects(rect) : hallObjects(rect);
}

function planter(x: number, z: number): THREE.BufferGeometry {
  const pot = new THREE.CylinderGeometry(PLANTER_RADIUS, PLANTER_RADIUS, PLANTER_HEIGHT, 10);
  pot.translate(x, PLANTER_HEIGHT / 2, z);
  return pot;
}

function corridorObjects(rect: WorldRect): THREE.BufferGeometry[] {
  const spanX = rect.x1 - rect.x0;
  const spanZ = rect.z1 - rect.z0;
  const alongX = spanX >= spanZ;
  const run = alongX ? spanX : spanZ;
  const acrossSpan = alongX ? spanZ : spanX;
  const acrossEdges =
    acrossSpan < NARROW_LANE
      ? [acrossSpan / 2]
      : [COMMON_EDGE_INSET, acrossSpan - COMMON_EDGE_INSET];

  const count = Math.max(1, Math.floor(run / CORRIDOR_PITCH));
  const step = run / count;
  const parts: THREE.BufferGeometry[] = [];
  for (let i = 0; i < count; i += 1) {
    const along = (alongX ? rect.x0 : rect.z0) + step * (i + 0.5);
    const across = (alongX ? rect.z0 : rect.x0) + acrossEdges[i % acrossEdges.length];
    const x = alongX ? along : across;
    const z = alongX ? across : along;
    if (i % 2 === 0) {
      const bench = new THREE.BoxGeometry(
        alongX ? BENCH_LENGTH : BENCH_DEPTH,
        BENCH_HEIGHT,
        alongX ? BENCH_DEPTH : BENCH_LENGTH,
      );
      bench.translate(x, BENCH_HEIGHT / 2, z);
      parts.push(bench);
    } else {
      parts.push(planter(x, z));
    }
  }
  return parts;
}

function hallObjects(rect: WorldRect): THREE.BufferGeometry[] {
  const spanX = rect.x1 - rect.x0;
  const spanZ = rect.z1 - rect.z0;
  const cols = Math.max(1, Math.floor(spanX / HALL_PITCH));
  const rows = Math.max(1, Math.floor(spanZ / HALL_PITCH));
  const originX = (rect.x0 + rect.x1) / 2 - (cols * HALL_PITCH) / 2;
  const originZ = (rect.z0 + rect.z1) / 2 - (rows * HALL_PITCH) / 2;

  const parts: THREE.BufferGeometry[] = [];
  for (let c = 0; c < cols; c += 1) {
    for (let r = 0; r < rows; r += 1) {
      if ((c + r) % 2 !== 0) continue;
      const table = new THREE.CylinderGeometry(TABLE_RADIUS, TABLE_RADIUS, TABLE_HEIGHT, 12);
      table.translate(
        originX + HALL_PITCH * (c + 0.5),
        TABLE_HEIGHT / 2,
        originZ + HALL_PITCH * (r + 0.5),
      );
      parts.push(table);
    }
  }
  for (const cx of [rect.x0 + COMMON_EDGE_INSET, rect.x1 - COMMON_EDGE_INSET]) {
    for (const cz of [rect.z0 + COMMON_EDGE_INSET, rect.z1 - COMMON_EDGE_INSET]) {
      parts.push(planter(cx, cz));
    }
  }
  return parts;
}

function whiteboard(room: WorldRect, facing: PlanAxis): THREE.BufferGeometry {
  const onX = IS_X_AXIS(facing);
  const span = (onX ? room.z1 - room.z0 : room.x1 - room.x0) * WHITEBOARD_SPAN;
  const board = new THREE.BoxGeometry(
    onX ? WHITEBOARD_THICKNESS : span,
    WHITEBOARD_HEIGHT,
    onX ? span : WHITEBOARD_THICKNESS,
  );
  const inset = POINTS_AT_MAX(facing) ? -WHITEBOARD_INSET : WHITEBOARD_INSET;
  const wall = POINTS_AT_MAX(facing)
    ? (onX ? room.x1 : room.z1)
    : (onX ? room.x0 : room.z0);
  board.translate(
    onX ? wall + inset : (room.x0 + room.x1) / 2,
    WHITEBOARD_BASE + WHITEBOARD_HEIGHT / 2,
    onX ? (room.z0 + room.z1) / 2 : wall + inset,
  );
  return board;
}

/**
 * Grid derived from the room's own size, so adding a classroom to the
 * annotation never means writing a desk count. The clamps keep a large hall
 * from exploding into hundreds of boxes.
 */
function desks(room: WorldRect): THREE.BufferGeometry[] {
  const usableX = (room.x1 - room.x0) * (1 - 2 * DESK_MARGIN);
  const usableZ = (room.z1 - room.z0) * (1 - 2 * DESK_MARGIN);
  const cols = Math.min(Math.max(Math.floor(usableX / DESK_PITCH_X), 1), DESK_MAX_COLS);
  const rows = Math.min(Math.max(Math.floor(usableZ / DESK_PITCH_Z), 1), DESK_MAX_ROWS);
  const originX = (room.x0 + room.x1) / 2 - (cols * DESK_PITCH_X) / 2;
  const originZ = (room.z0 + room.z1) / 2 - (rows * DESK_PITCH_Z) / 2;

  const boxes: THREE.BufferGeometry[] = [];
  for (let c = 0; c < cols; c += 1) {
    for (let r = 0; r < rows; r += 1) {
      const desk = new THREE.BoxGeometry(DESK_SIZE_X, DESK_HEIGHT, DESK_SIZE_Z);
      desk.translate(
        originX + DESK_PITCH_X * (c + 0.5),
        DESK_HEIGHT / 2,
        originZ + DESK_PITCH_Z * (r + 0.5),
      );
      boxes.push(desk);
    }
  }
  return boxes;
}
