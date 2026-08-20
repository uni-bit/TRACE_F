import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";

import { LEVEL_HEIGHT } from "./plan-transform";
import type { NeighborBuilding } from "./types";

export function buildNeighborMassings(
  neighbors: NeighborBuilding[],
): { solid: THREE.BufferGeometry; edges: THREE.BufferGeometry } | null {
  if (neighbors.length === 0) return null;
  const solids: THREE.BufferGeometry[] = [];
  const edgeParts: THREE.BufferGeometry[] = [];

  for (const neighbor of neighbors) {
    const height = neighbor.levels * LEVEL_HEIGHT;
    const shape = new THREE.Shape(
      neighbor.footprint.map(([x, z]) => new THREE.Vector2(x, z)),
    );
    const solid = new THREE.ExtrudeGeometry(shape, {
      depth: height,
      bevelEnabled: false,
    });
    // Preserve +z=plan south while turning extrusion from +Z into vertical -Y;
    // lifting by height then leaves every mass exactly on y=0.
    solid.rotateX(Math.PI / 2);
    solid.translate(0, height, 0);
    solids.push(solid);
    edgeParts.push(new THREE.EdgesGeometry(solid, 20));
  }

  const mergedSolid = mergeGeometries(solids);
  const mergedEdges = mergeGeometries(edgeParts);
  for (const geometry of [...solids, ...edgeParts]) geometry.dispose();
  return { solid: mergedSolid, edges: mergedEdges };
}
