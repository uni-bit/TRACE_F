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
 * Vertical companion to the plan scale: the storey pitch every stacked drawable
 * is measured against. It lives here so nothing outside this module invents its
 * own idea of how tall a floor is (an exaggerated value, see docs §3).
 */
export const LEVEL_HEIGHT = 0.42;

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

/**
 * Context-crop pixels to the classroom master's world XZ. Both crops use the
 * same registered PDF page, so their page-space origin delta is the complete
 * alignment transform — no second calibration or hand-authored offset.
 */
export function contextPxToWorld(
  px: number,
  py: number,
  plan: BuildingPlan,
  masterRect: MasterRect,
  contextRect: MasterRect,
): { x: number; z: number } {
  const transform = planTransform(plan);
  const scale = transform.width / masterRect.w;
  return {
    x: (px + contextRect.x - masterRect.x) * scale - transform.width / 2,
    z: (py + contextRect.y - masterRect.y) * scale - transform.depth / 2,
  };
}
