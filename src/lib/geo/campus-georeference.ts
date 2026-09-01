import { buildings, toyosuClassroom } from "@/lib/map/buildings";
import { buildingPlacement, METRES_PER_UNIT, type BuildingPlacement } from "@/lib/map/plan-transform";
import coordinates from "@/lib/map/toyosu-campus.coordinates.json";

/**
 * The only module that reads `toyosu-campus.coordinates.json` and turns it into
 * functions. `/map` must not import this: docs/floor-map-3d.md §1 promises the
 * viewer handles no positions, and §3.2 makes the JSON a hand-off artefact
 * rather than something the viewer reads. The dependency runs one way — this
 * module borrows the map's scale and placement, never the reverse.
 *
 * Frames, in the order the transform walks them:
 *
 *   plan px      per building, origin = crop top-left, +y = plan down
 *   plan metres  campus-wide, origin = centre of the classroom master rect
 *   local ENU    metres east/north about the georeference origin
 *   WGS84        lat/lon
 *
 * Every frame here is horizontal. The campus transform fixes height
 * (coordinate-mapping.md), so a floor travels alongside a position, never
 * inside it.
 */

export interface PlanPoint {
  buildingId: string;
  /** Pixels on that building's plan image (0..widthPx, 0..heightPx). */
  x: number;
  y: number;
}

/** Campus-wide drawing-sheet metres: +x = plan right, +z = plan DOWN. */
export interface PlanMetres {
  x: number;
  z: number;
}

export interface LocalEnu {
  east: number;
  north: number;
}

export interface Wgs84 {
  lat: number;
  lon: number;
}

export const COORDINATE_VERSION = coordinates.coordinateVersion;
export const NORTH_BEARING_DEG = coordinates.planToLocal.northBearingDeg;
export const ORIGIN: Wgs84 = { lat: coordinates.origin.lat, lon: coordinates.origin.lon };
export const ORIGIN_PLAN_POINT: PlanPoint = {
  buildingId: coordinates.origin.planPx.building,
  x: coordinates.origin.planPx.x,
  y: coordinates.origin.planPx.y,
};
export const ORIGIN_DESCRIPTION = coordinates.origin.description;
export const GEOFENCE_HULL: LocalEnu[] = coordinates.geofence.hullMetres.map(([east, north]) => ({ east, north }));
/** What one plan pixel is worth on the ground — the resolution of a tap. */
export const METRES_PER_PLAN_PX = coordinates.scale.metresPerMasterPx;

const EARTH_RADIUS = coordinates.localToWgs84.earthRadiusMetres;
const BEARING = (NORTH_BEARING_DEG * Math.PI) / 180;
const PLAN_ORIGIN: PlanMetres = coordinates.planToLocal.planOriginMetres;
const DEG_PER_RAD = 180 / Math.PI;
const LAT_COS = Math.cos((ORIGIN.lat * Math.PI) / 180);

const placements = new Map<string, BuildingPlacement>(
  buildings.map((building) => [building.id, buildingPlacement(building.masterRect, toyosuClassroom.masterRect)]),
);

function placementFor(buildingId: string): BuildingPlacement {
  const placement = placements.get(buildingId);
  if (!placement) throw new Error(`georeference: unknown building "${buildingId}"`);
  return placement;
}

function planFor(buildingId: string) {
  const building = buildings.find((candidate) => candidate.id === buildingId);
  if (!building) throw new Error(`georeference: unknown building "${buildingId}"`);
  return building.plan;
}

/** Normalized plan coordinates (±0.5, the space walls and footprints live in). */
export function planNormToMetres(buildingId: string, nx: number, nz: number): PlanMetres {
  const placement = placementFor(buildingId);
  return {
    x: (placement.offsetX + nx * placement.transform.width) * METRES_PER_UNIT,
    z: (placement.offsetZ + nz * placement.transform.depth) * METRES_PER_UNIT,
  };
}

export function planPxToMetres(point: PlanPoint): PlanMetres {
  const plan = planFor(point.buildingId);
  return planNormToMetres(point.buildingId, point.x / plan.widthPx - 0.5, point.y / plan.heightPx - 0.5);
}

export function metresToPlanPx(buildingId: string, metres: PlanMetres): { x: number; y: number } {
  const placement = placementFor(buildingId);
  const plan = planFor(buildingId);
  const nx = (metres.x / METRES_PER_UNIT - placement.offsetX) / placement.transform.width;
  const nz = (metres.z / METRES_PER_UNIT - placement.offsetZ) / placement.transform.depth;
  return { x: (nx + 0.5) * plan.widthPx, y: (nz + 0.5) * plan.heightPx };
}

/**
 * Plan metres -> local ENU. The matrix is a reflection, not a rotation (the
 * plan's +z runs down the sheet, the ground frame's north runs up), which is
 * why the same formula also runs it backwards — see `localToPlanMetres`.
 */
export function planMetresToLocal(metres: PlanMetres): LocalEnu {
  const dx = metres.x - PLAN_ORIGIN.x;
  const dz = metres.z - PLAN_ORIGIN.z;
  return {
    east: dx * Math.cos(BEARING) - dz * Math.sin(BEARING),
    north: -dx * Math.sin(BEARING) - dz * Math.cos(BEARING),
  };
}

/** Self-inverse of `planMetresToLocal`: a reflection is its own inverse. */
export function localToPlanMetres(local: LocalEnu): PlanMetres {
  return {
    x: local.east * Math.cos(BEARING) - local.north * Math.sin(BEARING) + PLAN_ORIGIN.x,
    z: -local.east * Math.sin(BEARING) - local.north * Math.cos(BEARING) + PLAN_ORIGIN.z,
  };
}

export function localToWgs84(local: LocalEnu): Wgs84 {
  return {
    lat: ORIGIN.lat + (local.north / EARTH_RADIUS) * DEG_PER_RAD,
    lon: ORIGIN.lon + (local.east / (EARTH_RADIUS * LAT_COS)) * DEG_PER_RAD,
  };
}

export function wgs84ToLocal(position: Wgs84): LocalEnu {
  return {
    east: ((position.lon - ORIGIN.lon) / DEG_PER_RAD) * EARTH_RADIUS * LAT_COS,
    north: ((position.lat - ORIGIN.lat) / DEG_PER_RAD) * EARTH_RADIUS,
  };
}

export function planPxToLocal(point: PlanPoint): LocalEnu {
  return planMetresToLocal(planPxToMetres(point));
}

export function planPxToWgs84(point: PlanPoint): Wgs84 {
  return localToWgs84(planPxToLocal(point));
}

/** Where a ground position falls on one building's plan, in that plan's pixels. */
export function localToPlanPx(buildingId: string, local: LocalEnu): { x: number; y: number } {
  return metresToPlanPx(buildingId, localToPlanMetres(local));
}

export function distanceMetres(a: LocalEnu, b: LocalEnu): number {
  return Math.hypot(a.east - b.east, a.north - b.north);
}

/** Compass bearing from `a` to `b`, degrees clockwise from true north. */
export function bearingDeg(a: LocalEnu, b: LocalEnu): number {
  return ((Math.atan2(b.east - a.east, b.north - a.north) * DEG_PER_RAD) + 360) % 360;
}

/**
 * Convex-hull containment with the margin coordinate-mapping.md asks for. The
 * hull is wound consistently by its generator, so one sign test per edge is
 * enough once the margin is applied as an outward offset of the edge line.
 */
export function insideGeofence(local: LocalEnu, marginMetres = 0): boolean {
  let sign = 0;
  for (let index = 0; index < GEOFENCE_HULL.length; index += 1) {
    const a = GEOFENCE_HULL[index];
    const b = GEOFENCE_HULL[(index + 1) % GEOFENCE_HULL.length];
    const edgeEast = b.east - a.east;
    const edgeNorth = b.north - a.north;
    const length = Math.hypot(edgeEast, edgeNorth) || 1;
    const cross = (edgeEast * (local.north - a.north) - edgeNorth * (local.east - a.east)) / length;
    if (Math.abs(cross) <= marginMetres) continue;
    const current = Math.sign(cross);
    if (sign === 0) sign = current;
    else if (current !== sign) return false;
  }
  return true;
}

/**
 * Every number this module derives also exists in the JSON, put there by a
 * different route. Disagreement means the JSON and the plan pipeline have
 * drifted apart, which is exactly the failure that would quietly move every
 * measured residual, so it fails at module init instead.
 */
function assertConsistentWithJson(): void {
  const metresPerMasterPx =
    (METRES_PER_UNIT * placementFor(toyosuClassroom.id).transform.width) / toyosuClassroom.plan.widthPx;
  if (Math.abs(metresPerMasterPx - coordinates.scale.metresPerMasterPx) > 1e-6) {
    throw new Error(
      `georeference: scale drift — the plan pipeline gives ${metresPerMasterPx} m/px, coordinates.json says ${coordinates.scale.metresPerMasterPx}`,
    );
  }
  if (Math.abs(METRES_PER_UNIT - coordinates.scale.metresPerUnit) > 1e-9) {
    throw new Error(`georeference: METRES_PER_UNIT ${METRES_PER_UNIT} != coordinates.json ${coordinates.scale.metresPerUnit}`);
  }
  const originLocal = planPxToLocal(ORIGIN_PLAN_POINT);
  if (Math.hypot(originLocal.east, originLocal.north) > 0.05) {
    throw new Error(
      `georeference: origin planPx maps to (${originLocal.east.toFixed(3)}, ${originLocal.north.toFixed(3)}) instead of (0, 0)`,
    );
  }
}

assertConsistentWithJson();
