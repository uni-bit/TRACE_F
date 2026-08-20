import type { NormRect } from "./types";

export function rectCovers(outer: NormRect, inner: NormRect): boolean {
  return (
    outer.x0 <= inner.x0 && outer.x1 >= inner.x1 && outer.z0 <= inner.z0 && outer.z1 >= inner.z1
  );
}

/** Subtract one axis-aligned rectangle, returning disjoint rectangular pieces. */
export function subtractRect(source: NormRect, cut: NormRect): NormRect[] {
  const x0 = Math.max(source.x0, cut.x0);
  const z0 = Math.max(source.z0, cut.z0);
  const x1 = Math.min(source.x1, cut.x1);
  const z1 = Math.min(source.z1, cut.z1);
  if (x0 >= x1 || z0 >= z1) return [source];

  const pieces: NormRect[] = [];
  if (source.z0 < z0) pieces.push({ x0: source.x0, z0: source.z0, x1: source.x1, z1: z0 });
  if (z1 < source.z1) pieces.push({ x0: source.x0, z0: z1, x1: source.x1, z1: source.z1 });
  if (source.x0 < x0) pieces.push({ x0: source.x0, z0, x1: x0, z1 });
  if (x1 < source.x1) pieces.push({ x0: x1, z0, x1: source.x1, z1 });
  return pieces;
}
