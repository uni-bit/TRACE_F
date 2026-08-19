import type { BuildingPlan } from "./types";

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

export function planTransform(plan: BuildingPlan): PlanTransform {
  return {
    width: PLAN_WORLD_WIDTH,
    depth: (PLAN_WORLD_WIDTH * plan.heightPx) / plan.widthPx,
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
