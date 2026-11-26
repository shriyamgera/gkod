import { mm, mm2 } from '#checks/format';
import {
  MAX_REACH_MM,
  MAX_REACH_SAMPLES,
  MIN_OVERHANG_MM2,
  NEAR_BED_MM,
  OVERHANG_TOLERANCE_DEG,
  SUPPORT_DROP_MM,
} from '#checks/limits';
import { across, type Mesh } from '#checks/mesh';
import type { CheckResult, Vec3 } from '#checks/types';

const title = 'No steep overhangs';

// A connected patch of steep faces underneath. size is its area seen from below, in mm².
type Patch = { faces: number[]; size: number; sum: Vec3 };

// Corner weights for the points a patch is sampled at: corners, edge middles and the centre of each triangle.
const samples = [
  [1, 0, 0], [0, 1, 0], [0, 0, 1],
  [0.5, 0.5, 0], [0, 0.5, 0.5], [0.5, 0, 0.5],
  [1 / 3, 1 / 3, 1 / 3],
] as const;

/**
 * Finds faces underneath that lean more than `deg` from vertical, groups them into patches by shared edges,
 * and fails patches that are big enough to matter and reach too far from anything that holds them up.
 */
export function checkOverhang(mesh: Mesh, onBed: Uint8Array, deg: number): CheckResult {
  const resting = restingFaces(mesh, onBed);
  const steep = steepFaces(mesh, resting, deg);
  const sagging = findPatches(mesh, steep)
    .filter((patch) => patch.size >= MIN_OVERHANG_MM2 && !heldUp(mesh, steep, resting, patch.faces))
    .sort((a, b) => b.size - a.size);
  const worst = sagging[0];
  if (!worst) return { id: 'overhang', ok: true, title, detail: 'Nothing underneath would need supports.' };

  const at = centre(mesh, worst);
  const where = `about ${mm2(worst.size)} mm² and ${mm(at[2] - mesh.min[2])} mm above the bed`;
  const detail =
    sagging.length === 1
      ? `An area underneath, ${where}, would sag while printing.`
      : `${sagging.length} areas underneath would sag while printing; the biggest is ${where}.`;
  return {
    id: 'overhang',
    ok: false,
    title,
    detail,
    fix: fixText(mesh, worst, sagging.length, at, deg),
    triangles: sagging.flatMap((patch) => patch.faces).sort((a, b) => a - b),
    at,
  };
}

// Says how far the biggest area reaches, so a fix can hold all of it up instead of only its middle.
function fixText(mesh: Mesh, worst: Patch, count: number, at: Vec3, deg: number): string {
  const [lo, hi] = extent(mesh, worst.faces);
  const height = hi[2] - lo[2] < 0.5 ? `z = ${mm(at[2])} mm` : `z = ${mm(lo[2])} to ${mm(hi[2])} mm`;
  const which = count === 1 ? 'The problem area' : `There are ${count} problem areas; the biggest`;
  return (
    `Change the design so no surface underneath leans more than ${mm(deg)} degrees from vertical; keep every named size. ` +
    `${which} is underneath at ${height} and spans x = ${mm(lo[0])} to ${mm(hi[0])} mm and y = ${mm(lo[1])} to ${mm(hi[1])} mm. ` +
    `Whatever holds it up, such as a slope of at most ${mm(deg)} degrees from vertical, must reach all of it. ` +
    'Turning the part so that surface rests on the bed also works.'
  );
}

function extent(mesh: Mesh, faces: number[]): [Vec3, Vec3] {
  const lo: Vec3 = [Infinity, Infinity, Infinity];
  const hi: Vec3 = [-Infinity, -Infinity, -Infinity];
  const p = mesh.positions;
  for (const t of faces) {
    for (let i = t * 9; i < t * 9 + 9; i++) {
      const k = i % 3;
      lo[k] = Math.min(lo[k]!, p[i]!);
      hi[k] = Math.max(hi[k]!, p[i]!);
    }
  }
  return [lo, hi];
}

// Faces on the bed, or so close to it that they sag onto it. Either way they hold up the faces next to them.
function restingFaces(mesh: Mesh, onBed: Uint8Array): Uint8Array {
  const top = mesh.min[2] + NEAR_BED_MM;
  const p = mesh.positions;
  const resting = Uint8Array.from(onBed);
  for (let t = 0; t < mesh.triangles; t++) {
    if (p[t * 9 + 2]! <= top && p[t * 9 + 5]! <= top && p[t * 9 + 8]! <= top) resting[t] = 1;
  }
  return resting;
}

function steepFaces(mesh: Mesh, resting: Uint8Array, deg: number): Uint8Array {
  const limit = -Math.sin((Math.min(90, deg + OVERHANG_TOLERANCE_DEG) * Math.PI) / 180);
  const steep = new Uint8Array(mesh.triangles);
  for (let t = 0; t < mesh.triangles; t++) {
    if (!mesh.skipped[t] && !resting[t] && mesh.areas[t]! > 0 && mesh.normals[t * 3 + 2]! < limit) steep[t] = 1;
  }
  return steep;
}

function findPatches(mesh: Mesh, steep: Uint8Array): Patch[] {
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
      patch = { faces: [], size: 0, sum: [0, 0, 0] };
      patches.set(key, patch);
    }
    const seen = -mesh.areas[t]! * mesh.normals[t * 3 + 2]!;
    patch.faces.push(t);
    patch.size += seen;
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

// True when every sampled point of the patch is within reach of an edge where a wall below holds it up.
function heldUp(mesh: Mesh, steep: Uint8Array, resting: Uint8Array, faces: number[]): boolean {
  const walls = holdingEdges(mesh, steep, resting, faces);
  if (walls.length === 0) return false;
  const p = mesh.positions;
  const step = Math.max(1, Math.ceil((faces.length * samples.length) / MAX_REACH_SAMPLES));
  let hint = 0;
  for (let i = 0; i < faces.length; i += step) {
    const o = faces[i]! * 9;
    for (const [a, b, c] of samples) {
      const x = a * p[o]! + b * p[o + 3]! + c * p[o + 6]!;
      const y = a * p[o + 1]! + b * p[o + 4]! + c * p[o + 7]!;
      const z = a * p[o + 2]! + b * p[o + 5]! + c * p[o + 8]!;
      hint = nearWall(walls, x, y, z, hint);
      if (hint < 0) return false;
    }
  }
  return true;
}

// Edges of the patch whose neighbour rests on the bed, goes down from the edge, or is a top face it meets
// at an inside corner, as where a ball or a rod lying down joins a plate. Six numbers per edge.
function holdingEdges(mesh: Mesh, steep: Uint8Array, resting: Uint8Array, faces: number[]): number[] {
  const p = mesh.positions;
  const walls: number[] = [];
  for (const t of faces) {
    for (let side = 0; side < 3; side++) {
      const edge = mesh.edges.ofSide[t * 3 + side]!;
      const other = across(mesh.edges, edge, t);
      if (other === -1 || steep[other]) continue;
      const i = t * 9 + side * 3;
      const j = t * 9 + ((side + 1) % 3) * 3;
      if (resting[other] || goesDown(p, other, i, j) || topInCorner(mesh, t, other, i)) {
        walls.push(p[i]!, p[i + 1]!, p[i + 2]!, p[j]!, p[j + 1]!, p[j + 2]!);
      }
    }
  }
  return walls;
}

// True when a corner of triangle t is below the edge from corner i to corner j, measured at the nearest point of the edge.
function goesDown(p: Float32Array, t: number, i: number, j: number): boolean {
  const dx = p[j]! - p[i]!, dy = p[j + 1]! - p[i + 1]!, dz = p[j + 2]! - p[i + 2]!;
  const length = dx * dx + dy * dy + dz * dz;
  for (let c = t * 9; c < t * 9 + 9; c += 3) {
    let k = length > 0 ? ((p[c]! - p[i]!) * dx + (p[c + 1]! - p[i + 1]!) * dy + (p[c + 2]! - p[i + 2]!) * dz) / length : 0;
    k = Math.max(0, Math.min(1, k));
    if (p[c + 2]! < p[i + 2]! + k * dz - SUPPORT_DROP_MM) return true;
  }
  return false;
}

// True when triangle t faces up and a corner of it lies in front of face f, so the edge between them is an inside corner.
function topInCorner(mesh: Mesh, f: number, t: number, i: number): boolean {
  const n = mesh.normals;
  if (n[t * 3 + 2]! <= 0) return false;
  const p = mesh.positions;
  const nx = n[f * 3]!, ny = n[f * 3 + 1]!, nz = n[f * 3 + 2]!;
  for (let c = t * 9; c < t * 9 + 9; c += 3) {
    if (nx * (p[c]! - p[i]!) + ny * (p[c + 1]! - p[i + 1]!) + nz * (p[c + 2]! - p[i + 2]!) > SUPPORT_DROP_MM) return true;
  }
  return false;
}

// Index of a wall edge within reach of the point, or -1. Starts at the last hit, since neighbouring points share walls.
function nearWall(walls: number[], x: number, y: number, z: number, hint: number): number {
  const count = walls.length / 6;
  const reach = MAX_REACH_MM * MAX_REACH_MM;
  for (let k = 0; k < count; k++) {
    const w = (hint + k) % count;
    if (distanceSq(walls, w * 6, x, y, z) <= reach) return w;
  }
  return -1;
}

function distanceSq(s: number[], o: number, x: number, y: number, z: number): number {
  const dx = s[o + 3]! - s[o]!, dy = s[o + 4]! - s[o + 1]!, dz = s[o + 5]! - s[o + 2]!;
  const length = dx * dx + dy * dy + dz * dz;
  let k = length > 0 ? ((x - s[o]!) * dx + (y - s[o + 1]!) * dy + (z - s[o + 2]!) * dz) / length : 0;
  k = Math.max(0, Math.min(1, k));
  const ex = s[o]! + k * dx - x, ey = s[o + 1]! + k * dy - y, ez = s[o + 2]! + k * dz - z;
  return ex * ex + ey * ey + ez * ez;
}

// The sampled point of the patch nearest to its centre, so the marker sits on the patch even when it is a ring.
function centre(mesh: Mesh, patch: Patch): Vec3 {
  const [cx, cy, cz] = patch.sum.map((value) => value / patch.size) as Vec3;
  const p = mesh.positions;
  let best = Infinity;
  let at: Vec3 = [cx, cy, cz];
  for (const t of patch.faces) {
    const o = t * 9;
    for (const [a, b, c] of samples) {
      const x = a * p[o]! + b * p[o + 3]! + c * p[o + 6]!;
      const y = a * p[o + 1]! + b * p[o + 4]! + c * p[o + 7]!;
      const z = a * p[o + 2]! + b * p[o + 5]! + c * p[o + 8]!;
      const d = (x - cx) ** 2 + (y - cy) ** 2 + (z - cz) ** 2;
      if (d < best) {
        best = d;
        at = [x, y, z];
      }
    }
  }
  return at;
}
