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

/* ------------------------------------------------------------------ *
 * Campus sheet frame
 *
 * One building's plan pixels only address that building. A surveyor standing
 * on the deck, in the cafeteria, or on the paving between them has no pixel to
 * point at, and a fix taken there lands outside every plan. The sheet frame is
 * the campus-wide pixel space that fixes both: the PDF page space the master
 * rectangles are already registered in, which every building's crop is a
 * window onto. One sheet pixel is METRES_PER_PLAN_PX on the ground, the same
 * as one classroom plan pixel, because the classroom crop is 1:1 with its
 * master rectangle (asserted below, along with the same property for every
 * other building — a rescaled crop would silently shear the composite).
 * ------------------------------------------------------------------ */

/** Pixels on the campus sheet: origin = SHEET top-left, +y = plan down. */
export interface CampusPx {
  x: number;
  y: number;
}

export interface CampusRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

const PRIMARY_RECT = toyosuClassroom.masterRect;
/** Ground the surveyor can stand on that no drawing covers — paving, road. */
const SHEET_MARGIN_METRES = 30;

export function campusPxToMetres(px: CampusPx): PlanMetres {
  return {
    x: (px.x - PRIMARY_RECT.x - PRIMARY_RECT.w / 2) * METRES_PER_PLAN_PX,
    z: (px.y - PRIMARY_RECT.y - PRIMARY_RECT.h / 2) * METRES_PER_PLAN_PX,
  };
}

export function metresToCampusPx(metres: PlanMetres): CampusPx {
  return {
    x: metres.x / METRES_PER_PLAN_PX + PRIMARY_RECT.x + PRIMARY_RECT.w / 2,
    y: metres.z / METRES_PER_PLAN_PX + PRIMARY_RECT.y + PRIMARY_RECT.h / 2,
  };
}

export function campusPxToLocal(px: CampusPx): LocalEnu {
  return planMetresToLocal(campusPxToMetres(px));
}

export function localToCampusPx(local: LocalEnu): CampusPx {
  return metresToCampusPx(localToPlanMetres(local));
}

export function campusPxToWgs84(px: CampusPx): Wgs84 {
  return localToWgs84(campusPxToLocal(px));
}

/** Sheet pixel -> a pixel on one building's plan image, unclamped. */
export function campusPxToPlanPx(buildingId: string, px: CampusPx): { x: number; y: number } {
  return metresToPlanPx(buildingId, campusPxToMetres(px));
}

export function planPxToCampusPx(point: PlanPoint): CampusPx {
  return metresToCampusPx(planPxToMetres(point));
}

/** Normalized plan coordinates (the frame walls and footprints live in). */
export function planNormToCampusPx(buildingId: string, nx: number, nz: number): CampusPx {
  return metresToCampusPx(planNormToMetres(buildingId, nx, nz));
}

/** Where a building's plan image belongs on the sheet. */
export function buildingSheetRect(buildingId: string): CampusRect {
  const rect = buildings.find((candidate) => candidate.id === buildingId)?.masterRect;
  if (!rect) throw new Error(`georeference: unknown building "${buildingId}"`);
  return { x: rect.x, y: rect.y, width: rect.w, height: rect.h };
}

/**
 * Every drawn slab corner on the sheet. The view is fitted to these rather
 * than to a bounding rectangle: the campus runs on a diagonal, so its upright
 * rectangle is half empty, and once the sheet is turned to north that empty
 * half is what decides the zoom.
 */
export const CAMPUS_OUTLINE: CampusPx[] = buildings.flatMap((building) =>
  building.floors.flatMap((floor) => footprintCampusPx(building.id, floor.id)),
);

/**
 * The drawn campus plus a margin of undrawn ground, and then whatever of the
 * geofence still falls outside that. Sized so the surveyor can point at where
 * they are standing even when that is not on any drawing.
 */
export const CAMPUS_SHEET: CampusRect = (() => {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  const grow = (x: number, y: number) => {
    x0 = Math.min(x0, x);
    y0 = Math.min(y0, y);
    x1 = Math.max(x1, x);
    y1 = Math.max(y1, y);
  };
  const margin = SHEET_MARGIN_METRES / METRES_PER_PLAN_PX;
  for (const building of buildings) {
    const rect = building.masterRect;
    grow(rect.x - margin, rect.y - margin);
    grow(rect.x + rect.w + margin, rect.y + rect.h + margin);
  }
  for (const vertex of GEOFENCE_HULL) {
    const px = localToCampusPx(vertex);
    grow(px.x, px.y);
  }
  return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
})();

/** Ray casting; the footprints are concave, so a winding test will not do. */
function insidePolygon(point: LocalEnu, polygon: LocalEnu[]): boolean {
  let inside = false;
  for (let index = 0, previous = polygon.length - 1; index < polygon.length; previous = index, index += 1) {
    const a = polygon[index];
    const b = polygon[previous];
    if (
      a.north > point.north !== b.north > point.north &&
      point.east < ((b.east - a.east) * (point.north - a.north)) / (b.north - a.north) + a.east
    ) {
      inside = !inside;
    }
  }
  return inside;
}

/** One building's slab outline for a floor, in ground coordinates. */
export function footprintLocal(buildingId: string, floorId: string): LocalEnu[] {
  const building = buildings.find((candidate) => candidate.id === buildingId);
  if (!building) throw new Error(`georeference: unknown building "${buildingId}"`);
  const outline = building.features.footprints.byFloor[floorId] ?? building.features.footprints.default;
  return outline.map(([nx, nz]) => planMetresToLocal(planNormToMetres(buildingId, nx, nz)));
}

/** The same outline on the campus sheet, for drawing rather than testing. */
export function footprintCampusPx(buildingId: string, floorId: string): CampusPx[] {
  const building = buildings.find((candidate) => candidate.id === buildingId);
  if (!building) throw new Error(`georeference: unknown building "${buildingId}"`);
  const outline = building.features.footprints.byFloor[floorId] ?? building.features.footprints.default;
  return outline.map(([nx, nz]) => metresToCampusPx(planNormToMetres(buildingId, nx, nz)));
}

/**
 * Which structures a ground position falls inside.
 *
 * Containment is horizontal, so without a level the answer stacks: the roof
 * garden sits on the classroom building and the deck spans the paving between
 * the towers, and a point can be inside all of them at once. Passing the level
 * cuts the stack to the structures that have a floor there, which is what
 * makes "教室棟" rather than "教室棟屋上庭園" the answer on 1F.
 */
export function structuresAt(local: LocalEnu, level?: number): string[] {
  return buildings
    .filter((building) => {
      const floor =
        level === undefined ? building.floors[0] : building.floors.find((candidate) => candidate.level === level);
      return floor !== undefined && insidePolygon(local, footprintLocal(building.id, floor.id));
    })
    .map((building) => building.id);
}

/**
 * The sheet frame assumes each crop is 1:1 with its master rectangle, and that
 * arithmetic on the sheet is the same arithmetic `planPxToMetres` does per
 * building. Both are properties of generated data, so both are checked here
 * rather than trusted: a rescaled crop would put a building metres away from
 * where its own plan pixels say it is, and nothing downstream would notice.
 */
function assertSheetFrame(): void {
  for (const building of buildings) {
    if (building.masterRect.w !== building.plan.widthPx || building.masterRect.h !== building.plan.heightPx) {
      throw new Error(
        `georeference: ${building.id} crop ${building.plan.widthPx}x${building.plan.heightPx} is not 1:1 with its master rect ${building.masterRect.w}x${building.masterRect.h}`,
      );
    }
    const corner = { buildingId: building.id, x: building.plan.widthPx, y: building.plan.heightPx };
    const viaPlan = planPxToMetres(corner);
    const viaSheet = campusPxToMetres({
      x: building.masterRect.x + building.masterRect.w,
      y: building.masterRect.y + building.masterRect.h,
    });
    // Not exact: the sheet works in the JSON's published metres-per-pixel,
    // which is rounded, while the plan frame carries the pipeline's full
    // precision. That is a fifth of a millimetre across the whole campus. The
    // failure this guards against — a crop rescaled away from its master rect —
    // is metres, so the tolerance is set where nothing real hides under it.
    if (Math.abs(viaPlan.x - viaSheet.x) > 0.01 || Math.abs(viaPlan.z - viaSheet.z) > 0.01) {
      throw new Error(`georeference: sheet frame disagrees with the plan frame for ${building.id}`);
    }
  }
}

assertSheetFrame();
