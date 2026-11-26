import type { Mesh } from '#checks/mesh';
import type { Vec3 } from '#checks/types';

/** A connected patch of steep faces underneath. size is its area seen from below in mm², sum its area-weighted centre times size. */
export type Patch = { faces: number[]; size: number; sum: Vec3; lowest: number };

/** Groups the steep faces into patches of faces that share an edge. */
export function findPatches(mesh: Mesh, steep: Uint8Array): Patch[] {
  const parent = new Int32Array(mesh.triangles);
  for (let t = 0; t < mesh.triangles; t++) parent[t] = t;
  const { faces, first, second } = mesh.edges;
  for (let e = 0; e < faces.length; e++) {
    if (faces[e] !== 2 || !steep[first[e]!] || !steep[second[e]!]) continue;
    parent[root(parent, first[e]!)] = root(parent, second[e]!);
  }
  const patches = new Map<number, Patch>();
  const p = mesh.positions;
  for (let t = 0; t < mesh.triangles; t++) {
    if (!steep[t]) continue;
    const key = root(parent, t);
    let patch = patches.get(key);
    if (!patch) {
      patch = { faces: [], size: 0, sum: [0, 0, 0], lowest: Infinity };
      patches.set(key, patch);
    }
    const seen = -mesh.areas[t]! * mesh.normals[t * 3 + 2]!;
    patch.faces.push(t);
    patch.size += seen;
    patch.lowest = Math.min(patch.lowest, p[t * 9 + 2]!, p[t * 9 + 5]!, p[t * 9 + 8]!);
    for (let k = 0; k < 3; k++) patch.sum[k]! += (seen * (p[t * 9 + k]! + p[t * 9 + 3 + k]! + p[t * 9 + 6 + k]!)) / 3;
  }
  return [...patches.values()];
}

function root(parent: Int32Array, t: number): number {
  while (parent[t] !== t) {
    const up = parent[parent[t]!]!;
    parent[t] = up;
    t = up;
  }
  return t;
}

// Corner weights for the points a patch is sampled at: corners, edge middles and the centre of each triangle.
const samples = [
  [1, 0, 0], [0, 1, 0], [0, 0, 1],
  [0.5, 0.5, 0], [0, 0.5, 0.5], [0.5, 0, 0.5],
  [1 / 3, 1 / 3, 1 / 3],
] as const;

/** Points sampled per face. */
export const SAMPLES = samples.length;

/** Visits the sampled points of the faces, until visit returns false. Returns false when it stopped early. */
export function eachPoint(mesh: Mesh, faces: number[], visit: (x: number, y: number, z: number) => boolean): boolean {
  const p = mesh.positions;
  for (const t of faces) {
    const o = t * 9;
    for (const [a, b, c] of samples) {
      const x = a * p[o]! + b * p[o + 3]! + c * p[o + 6]!;
      const y = a * p[o + 1]! + b * p[o + 4]! + c * p[o + 7]!;
      const z = a * p[o + 2]! + b * p[o + 5]! + c * p[o + 8]!;
      if (!visit(x, y, z)) return false;
    }
  }
  return true;
}
