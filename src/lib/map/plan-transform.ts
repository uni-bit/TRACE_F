import type { BuildingPlan, MasterRect } from "./types";

/**
 * The single normalized-plan -> world mapping. Every drawable (plan texture,
 * slab, walls) must go through this so the texture and the extracted walls can
 * never drift apart in scale or aspect.
 */
export interface PlanTransform {
  width: number;
  depth: number;
}

const PLAN_WORLD_WIDTH = 6;

/**
 * What one world unit is worth on the ground. The plan scale on its own is
 * self-consistent but dimensionless — it can say the campus is this many
 * classroom-widths across and nothing more — so the vertical dimension had no
 * honest number to be measured against. Three independent measurements agree
 * on this one (docs §3.1): the headquarters' published 建築面積 4,323.08 m²
 * against its traced 4F plate gives 9.24, a georeferenced fit of the modelled
 * footprints onto aerial imagery gives 9.37, and the basketball court drawn on
 * the B1F plan measures 26.8 x 15.5 m at 9.3.
 */
export const METRES_PER_UNIT = 9.3;

/**
 * Vertical companion to the plan scale: the storey pitch every stacked drawable
 * is measured against. It lives here so nothing outside this module invents its
 * own idea of how tall a floor is.
 *
 * One pitch for the whole campus is not a simplification — the bridges force
 * it. The west connector joins the classroom and cafeteria buildings at 2F, 4F
 * and 6F and the east connector joins the cafeteria and headquarters at 4F and
 * 6F, so those floors have to arrive at the same height in every building.
 * 4.2 m is the headquarters' published 基準階階高; it also reads across to the
 * research building, whose 14 storeys stand 67.5 m to the top of the parapet.
 */
const STOREY_METRES = 4.2;
export const LEVEL_HEIGHT = STOREY_METRES / METRES_PER_UNIT;

/**
 * True-north bearing, in degrees clockwise, of "up" on the drawing sheet. The
 * campus diary draws every floor square to the buildings, and the buildings sit
 * on a grid turned nearly halfway to the diagonal, so plan north is not north.
 * Measured three ways and agreeing to about a degree: a length-weighted fit of
 * OpenStreetMap's building edges gives 42.8, Hough lines over aerial imagery of
 * the block give 43.6, and the model-to-aerial fit above gives 41.9.
 *
 * The viewer turns the whole campus by this angle so that the world it renders
 * has north where north is; nothing in the plan pipeline knows about it.
 */
export const PLAN_NORTH_BEARING_DEG = 43;

export function planTransform(plan: BuildingPlan): PlanTransform {
  return {
    width: PLAN_WORLD_WIDTH,
    depth: (PLAN_WORLD_WIDTH * plan.heightPx) / plan.widthPx,
  };
}

export interface BuildingPlacement {
  transform: PlanTransform;
  offsetX: number;
  offsetZ: number;
}

/**
 * Place a registered building in the primary building's world coordinate
 * system. Both scale and offset come only from the two PDF master rectangles.
 */
export function buildingPlacement(
  masterRect: MasterRect,
  primaryRect: MasterRect,
): BuildingPlacement {
  const scale = PLAN_WORLD_WIDTH / primaryRect.w;
  const width = masterRect.w * scale;
  const depth = masterRect.h * scale;
  return {
    transform: { width, depth },
    offsetX: (masterRect.x - primaryRect.x) * scale - PLAN_WORLD_WIDTH / 2 + width / 2,
    offsetZ:
      (masterRect.y - primaryRect.y) * scale - (primaryRect.h * scale) / 2 + depth / 2,
  };
}

export function toWorldX(nx: number, transform: PlanTransform): number {
  return nx * transform.width;
}

export function toWorldZ(nz: number, transform: PlanTransform): number {
  return nz * transform.depth;
}

/**
 * Master-rect pixel coordinates (origin = crop top-left, +y = plan down) to
 * normalized plan coordinates (±0.5). Hand-maintained feature annotations are
 * written in pixels because they are measured directly on debug/crop-*.png.
 */
export function planPxToNormalized(px: number, py: number, plan: BuildingPlan): { nx: number; nz: number } {
  return { nx: px / plan.widthPx - 0.5, nz: py / plan.heightPx - 0.5 };
}
