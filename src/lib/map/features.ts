import { planPxToNormalized } from "./plan-transform";
import { subtractRect } from "./rect-utils";
import type {
  BuildingFeatures,
  BuildingPlan,
  FloorFeatures,
  NormRect,
  PlanAxis,
} from "./types";

/**
 * Loads the hand-maintained feature annotations (master-rect pixels, see
 * scripts/floorplan for the measuring workflow) and returns them normalized
 * to ±0.5 plan coordinates. Any inconsistency throws at module init so an
 * annotation typo fails the build instead of shipping.
 */

type PxRect = number[];

interface RawFloorFeatures {
  voids?: { rect: PxRect; kind: string }[];
  stairs?: { id: string; rect: PxRect; up: string; down?: boolean }[];
  escalators?: { id: string; rect: PxRect; up: string; lanes: number }[];
  classrooms?: { x: number[]; rows: number[][]; facing?: string }[];
  commons?: { rect: PxRect; kind: string }[];
  /**
   * Drawing that is not wall: vending machines, automatic doors, furniture
   * blocks. The wall extractor sees every long cyan run, so a hatched symbol
   * arrives as a bundle of parallel "walls". Masking it there keeps the
   * symbol in the plan texture while leaving it out of the geometry, which
   * `eraserRects` (which whites the crop out) cannot do.
   */
  wallMasks?: { rect: PxRect; note?: string }[];
}

export interface RawBuildingFeatures {
  schemaVersion: number;
  buildingId: string;
  footprints: Record<string, number[][]> & { default: number[][] };
  elevators: { id: string; rect: number[]; levels: number[] }[];
  floors: Record<string, RawFloorFeatures>;
}

const AXES: PlanAxis[] = ["+x", "-x", "+z", "-z"];
const VOID_KINDS = ["atrium", "escalator-well", "stair-well"];
const COMMON_KINDS = ["corridor", "hall"];

let featureSource = "floor features";

function fail(message: string): never {
  throw new Error(`${featureSource}: ${message}`);
}

function checkAxis(value: string, context: string): PlanAxis {
  if (!AXES.includes(value as PlanAxis)) fail(`${context}: invalid axis "${value}"`);
  return value as PlanAxis;
}

function normRect(rect: PxRect, plan: BuildingPlan, context: string): NormRect {
  if (rect.length !== 4) fail(`${context}: rect [${rect}] must have 4 entries`);
  const [x0, y0, x1, y1] = rect;
  if (x0 >= x1 || y0 >= y1) fail(`${context}: rect [${rect}] is not x0<x1, y0<y1`);
  if (x0 < 0 || y0 < 0 || x1 > plan.widthPx || y1 > plan.heightPx) {
    fail(`${context}: rect [${rect}] leaves the ${plan.widthPx}x${plan.heightPx} master rect`);
  }
  const a = planPxToNormalized(x0, y0, plan);
  const b = planPxToNormalized(x1, y1, plan);
  return { x0: a.nx, z0: a.nz, x1: b.nx, z1: b.nz };
}

function normPolygon(points: [number, number][], plan: BuildingPlan, context: string): [number, number][] {
  if (points.length < 3) fail(`${context}: footprint needs at least 3 points`);
  return points.map(([px, py]) => {
    if (px < 0 || py < 0 || px > plan.widthPx || py > plan.heightPx) {
      fail(`${context}: point [${px}, ${py}] leaves the master rect`);
    }
    const { nx, nz } = planPxToNormalized(px, py, plan);
    return [nx, nz];
  });
}

function normFloor(floorId: string, features: RawFloorFeatures, plan: BuildingPlan): FloorFeatures {
  const at = (what: string) => `floor ${floorId} ${what}`;
  return {
    voids: (features.voids ?? []).map((v, i) => {
      if (!VOID_KINDS.includes(v.kind)) fail(`${at(`void #${i}`)}: invalid kind "${v.kind}"`);
      return { rect: normRect(v.rect, plan, at(`void #${i}`)), kind: v.kind as FloorFeatures["voids"][number]["kind"] };
    }),
    stairs: (features.stairs ?? []).map((s) => ({
      id: s.id,
      rect: normRect(s.rect, plan, at(`stair ${s.id}`)),
      up: checkAxis(s.up, at(`stair ${s.id}`)),
      down: s.down === true,
    })),
    escalators: (features.escalators ?? []).map((e) => ({
      id: e.id,
      rect: normRect(e.rect, plan, at(`escalator ${e.id}`)),
      up: checkAxis(e.up, at(`escalator ${e.id}`)),
      lanes: e.lanes,
    })),
    classrooms: (features.classrooms ?? []).map((c, i) => {
      const context = at(`classroom band #${i}`);
      if (c.x.length !== 2 || c.rows.length === 0) fail(`${context}: needs x=[x0,x1] and at least one row`);
      const rect = normRect([c.x[0], c.rows[0][0], c.x[1], c.rows[c.rows.length - 1][1]], plan, context);
      return {
        x: [rect.x0, rect.x1] as [number, number],
        rows: c.rows.map((row, j) => {
          const r = normRect([c.x[0], row[0], c.x[1], row[1]], plan, `${context} row #${j}`);
          return [r.z0, r.z1] as [number, number];
        }),
        facing: checkAxis(c.facing ?? "-z", context),
      };
    }),
    // Consumed by the Python wall extractor; normalized here only so a
    // malformed rect fails at load like every other annotation.
    ...(features.wallMasks
      ? { wallMasks: features.wallMasks.map((m, i) => normRect(m.rect, plan, at(`wallMask #${i}`))) }
      : {}),
    commons: (features.commons ?? []).map((c, i) => {
      if (!COMMON_KINDS.includes(c.kind)) fail(`${at(`common #${i}`)}: invalid kind "${c.kind}"`);
      return {
        rect: normRect(c.rect, plan, at(`common #${i}`)),
        kind: c.kind as FloorFeatures["commons"][number]["kind"],
      };
    }),
  };
}

/**
 * Nothing may be annotated onto ground the slab does not have. A stair, a
 * corridor or a lift measured against the wrong floor's outline does not fail
 * loudly at runtime — it renders perfectly, floating in mid-air beside the
 * building — so the containment is checked here where a typo can still be
 * caught. Sampled rather than corner-tested: footprints are concave, so four
 * corners inside says nothing about the middle.
 */
const CONTAINMENT_SAMPLES = 12;

function pointInPolygon(x: number, z: number, polygon: [number, number][]): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [ax, az] = polygon[i];
    const [bx, bz] = polygon[j];
    if ((az > z) !== (bz > z) && x < ((bx - ax) * (z - az)) / (bz - az) + ax) inside = !inside;
  }
  return inside;
}

type Containment = "inside" | "outside" | "partial";

function containment(rect: NormRect, footprint: [number, number][]): Containment {
  const n = CONTAINMENT_SAMPLES;
  let hits = 0;
  for (let i = 0; i < n; i += 1) {
    for (let j = 0; j < n; j += 1) {
      const x = rect.x0 + ((i + 0.5) / n) * (rect.x1 - rect.x0);
      const z = rect.z0 + ((j + 0.5) / n) * (rect.z1 - rect.z0);
      if (pointInPolygon(x, z, footprint)) hits += 1;
    }
  }
  if (hits === 0) return "outside";
  return hits === n * n ? "inside" : "partial";
}

function checkInside(rect: NormRect, footprint: [number, number][], context: string): void {
  if (containment(rect, footprint) !== "inside") fail(`${context}: leaves the floor footprint`);
}

export interface LoadedFeatures {
  building: BuildingFeatures;
  byFloor: Record<string, FloorFeatures>;
}

type FloorRef = { id: string; level: number };

function addInheritedEscalatorVoids(
  byFloor: Record<string, FloorFeatures>,
  floors: FloorRef[],
  footprintOf: (floorId: string) => [number, number][],
): void {
  const byLevel = new Map(floors.map((floor) => [floor.level, floor]));
  for (const floor of floors) {
    if (floor.level < 2) continue;
    const lower = byLevel.get(floor.level - 1);
    // Independent bridges/decks intentionally contain only the levels on
    // which the structure exists, so a sparse target can have no lower slab.
    if (!lower) continue;
    const footprint = footprintOf(floor.id);

    for (const escalator of byFloor[lower.id].escalators) {
      // Where this floor is set back, the escalator below rises past its edge
      // into open air: there is no slab to punch a well through. Punching one
      // anyway hands ExtrudeGeometry a hole outside its own contour.
      const cover = containment(escalator.rect, footprint);
      if (cover === "outside") continue;
      if (cover === "partial") {
        fail(
          `floor ${floor.id}: inherited escalator ${escalator.id} straddles the footprint edge`,
        );
      }
      let remainder = [escalator.rect];
      for (const existing of byFloor[floor.id].voids) {
        remainder = remainder.flatMap((rect) => subtractRect(rect, existing.rect));
        if (remainder.length > 1) {
          fail(
            `floor ${floor.id}: inherited escalator ${escalator.id} minus existing voids is not rectangular`,
          );
        }
      }
      if (remainder.length === 1) {
        byFloor[floor.id].voids.push({ rect: remainder[0], kind: "escalator-well" });
      }
    }
  }
}

/**
 * A flight climbs from this floor's slab to the one above (§12.1) — and then,
 * until now, stopped dead against it, because no floor in the campus was ever
 * annotated with a well over the stair below. Every stair in the model ran
 * into a ceiling, and from above the plate simply read as floor laid over the
 * treads.
 *
 * The opening is derived rather than hand-measured for the same reason the
 * escalators' is: it is not a fact about the upper floor's drawing, it is a
 * consequence of the lower floor's stair, and deriving it cannot fall out of
 * step with what it is derived from. A stair that reaches a floor which is set
 * back over it punches nothing — there is no slab there to cut.
 */
function addInheritedStairVoids(
  byFloor: Record<string, FloorFeatures>,
  floors: FloorRef[],
  footprintOf: (floorId: string) => [number, number][],
): void {
  const byLevel = new Map(floors.map((floor) => [floor.level, floor]));
  for (const floor of floors) {
    const above = byLevel.get(floor.level + 1);
    if (!above) continue;
    const footprint = footprintOf(above.id);
    for (const stair of byFloor[floor.id].stairs) {
      // A descending flight already hangs below this floor; its opening, if
      // any, belongs to the floor it came from.
      if (stair.down) continue;
      if (containment(stair.rect, footprint) !== "inside") continue;
      // The remainder is kept as however many rectangles it takes rather than
      // required to stay one, because an atrium already clipping a corner off
      // the stair (headquarters 4F) is a legitimate drawing, not a mistake:
      // their union is still exactly the stair minus what is already open.
      let remainder = [stair.rect];
      for (const existing of byFloor[above.id].voids) {
        remainder = remainder.flatMap((rect) => subtractRect(rect, existing.rect));
        if (remainder.length === 0) break;
      }
      for (const rect of remainder) {
        byFloor[above.id].voids.push({ rect, kind: "stair-well" });
      }
    }
  }
}

export function loadFeatures(
  raw: RawBuildingFeatures,
  buildingId: string,
  plan: BuildingPlan,
  floors: FloorRef[],
  source = `${buildingId}.features.json`,
): LoadedFeatures {
  featureSource = source;
  if (raw.buildingId !== buildingId) fail(`buildingId "${raw.buildingId}" does not match "${buildingId}"`);
  if (raw.schemaVersion !== 1) fail(`unsupported schemaVersion ${raw.schemaVersion}`);
  const floorIds = floors.map((floor) => floor.id);
  const maxLevel = Math.max(...floors.map((floor) => floor.level));
  // Not 1: a shaft in a building with a basement starts below grade.
  const minLevel = Math.min(...floors.map((floor) => floor.level));

  const byFloor: Record<string, FloorFeatures> = {};
  for (const [floorId, features] of Object.entries(raw.floors as Record<string, RawFloorFeatures>)) {
    if (!floorIds.includes(floorId)) fail(`floor "${floorId}" does not exist in the generated geometry`);
    byFloor[floorId] = normFloor(floorId, features, plan);
  }
  for (const floorId of floorIds) {
    byFloor[floorId] ??= { voids: [], stairs: [], escalators: [], classrooms: [], commons: [] };
  }
  const footprintsByFloor: Record<string, [number, number][]> = {};
  for (const [floorId, points] of Object.entries(raw.footprints)) {
    if (floorId === "default") continue;
    if (!floorIds.includes(floorId)) fail(`footprint for unknown floor "${floorId}"`);
    footprintsByFloor[floorId] = normPolygon(points as [number, number][], plan, `footprint ${floorId}`);
  }

  const defaultFootprint = normPolygon(
    raw.footprints.default as [number, number][],
    plan,
    "footprint default",
  );
  const footprintOf = (floorId: string) => footprintsByFloor[floorId] ?? defaultFootprint;

  addInheritedEscalatorVoids(byFloor, floors, footprintOf);
  addInheritedStairVoids(byFloor, floors, footprintOf);

  const elevators = raw.elevators.map((e) => {
    const [lo, hi] = e.levels;
    if (lo < minLevel || hi > maxLevel || lo > hi) {
      fail(`elevator ${e.id}: levels [${e.levels}] outside ${minLevel}..${maxLevel}`);
    }
    return {
      id: e.id,
      rect: normRect(e.rect as PxRect, plan, `elevator ${e.id}`),
      levels: [lo, hi] as [number, number],
    };
  });

  for (const floor of floors) {
    const footprint = footprintOf(floor.id);
    const at = (what: string) => `floor ${floor.id} ${what}`;
    const features = byFloor[floor.id];
    // Inherited escalator wells are derived from the floor below, so they are
    // checked here too rather than trusted.
    for (const v of features.voids) checkInside(v.rect, footprint, at(`void (${v.kind})`));
    for (const s of features.stairs) checkInside(s.rect, footprint, at(`stair ${s.id}`));
    for (const e of features.escalators) checkInside(e.rect, footprint, at(`escalator ${e.id}`));
    for (const [i, c] of features.commons.entries()) checkInside(c.rect, footprint, at(`common #${i}`));
    for (const [i, band] of features.classrooms.entries()) {
      for (const [j, [z0, z1]] of band.rows.entries()) {
        checkInside({ x0: band.x[0], z0, x1: band.x[1], z1 }, footprint, at(`classroom band #${i} row #${j}`));
      }
    }
    for (const elevator of elevators) {
      if (floor.level < elevator.levels[0] || floor.level > elevator.levels[1]) continue;
      checkInside(elevator.rect, footprint, at(`elevator ${elevator.id}`));
    }
  }

  return {
    building: {
      footprints: { default: defaultFootprint, byFloor: footprintsByFloor },
      elevators,
    },
    byFloor,
  };
}
