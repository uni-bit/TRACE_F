import raw from "./toyosu-context.features.json";
import { contextPxToWorld, type PixelRect } from "./plan-transform";
import type { BuildingPlan, NeighborBuilding } from "./types";

type RawNeighbor = {
  id: string;
  name: string;
  levels: number;
  footprint: number[][];
};

function fail(message: string): never {
  throw new Error(`toyosu-context.features.json: ${message}`);
}

export function loadContextFeatures(
  buildingId: string,
  plan: BuildingPlan,
  masterRect: PixelRect,
  contextRect: PixelRect,
): NeighborBuilding[] {
  if (raw.buildingId !== buildingId) fail(`buildingId "${raw.buildingId}" does not match "${buildingId}"`);
  if (raw.schemaVersion !== 1) fail(`unsupported schemaVersion ${raw.schemaVersion}`);

  const ids = new Set<string>();
  return (raw.neighbors as RawNeighbor[]).map((neighbor) => {
    if (!neighbor.id || ids.has(neighbor.id)) fail(`missing or duplicate id "${neighbor.id}"`);
    ids.add(neighbor.id);
    if (!Number.isInteger(neighbor.levels) || neighbor.levels < 1) {
      fail(`${neighbor.id}: levels must be a positive integer`);
    }
    if (neighbor.footprint.length < 3) fail(`${neighbor.id}: footprint needs at least 3 points`);
    const footprint = neighbor.footprint.map((point, index): [number, number] => {
      if (point.length !== 2) fail(`${neighbor.id} point #${index}: expected [x,y]`);
      const [px, py] = point;
      if (px < 0 || py < 0 || px > contextRect.w || py > contextRect.h) {
        fail(`${neighbor.id} point #${index} [${point}] leaves the context rect`);
      }
      const { x, z } = contextPxToWorld(px, py, plan, masterRect, contextRect);
      return [x, z];
    });
    return { id: neighbor.id, name: neighbor.name, levels: neighbor.levels, footprint };
  });
}
