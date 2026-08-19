import raw from "./toyosu-classroom.features.json";
import { planPxToNormalized } from "./plan-transform";
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
  stairs?: { id: string; rect: PxRect; up: string }[];
  escalators?: { id: string; rect: PxRect; up: string; lanes: number }[];
  classrooms?: { x: number[]; rows: number[][]; facing?: string }[];
  commons?: { rect: PxRect; kind: string }[];
}

const AXES: PlanAxis[] = ["+x", "-x", "+z", "-z"];
const VOID_KINDS = ["atrium", "escalator-well", "stair-well"];
const COMMON_KINDS = ["corridor", "hall"];

function fail(message: string): never {
  throw new Error(`toyosu-classroom.features.json: ${message}`);
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
    commons: (features.commons ?? []).map((c, i) => {
      if (!COMMON_KINDS.includes(c.kind)) fail(`${at(`common #${i}`)}: invalid kind "${c.kind}"`);
      return {
        rect: normRect(c.rect, plan, at(`common #${i}`)),
        kind: c.kind as FloorFeatures["commons"][number]["kind"],
      };
    }),
  };
}

export interface LoadedFeatures {
  building: BuildingFeatures;
  byFloor: Record<string, FloorFeatures>;
}

export function loadFeatures(buildingId: string, plan: BuildingPlan, floorIds: string[], maxLevel: number): LoadedFeatures {
  if (raw.buildingId !== buildingId) fail(`buildingId "${raw.buildingId}" does not match "${buildingId}"`);
  if (raw.schemaVersion !== 1) fail(`unsupported schemaVersion ${raw.schemaVersion}`);

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

  return {
    building: {
      footprints: {
        default: normPolygon(raw.footprints.default as [number, number][], plan, "footprint default"),
        byFloor: footprintsByFloor,
      },
      elevators: raw.elevators.map((e) => {
        const [lo, hi] = e.levels;
        if (lo < 1 || hi > maxLevel || lo > hi) fail(`elevator ${e.id}: levels [${e.levels}] outside 1..${maxLevel}`);
        return {
          id: e.id,
          rect: normRect(e.rect as PxRect, plan, `elevator ${e.id}`),
          levels: [lo, hi] as [number, number],
        };
      }),
    },
    byFloor,
  };
}
