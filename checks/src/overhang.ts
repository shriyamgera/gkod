import { mm, mm2 } from '#checks/format';
import { MAX_REACH_MM, MAX_REACH_SAMPLES, MIN_OVERHANG_MM2, OVERHANG_SLACK_DEG, SUPPORT_DROP_MM } from '#checks/limits';
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
  const steep = steepFaces(mesh, onBed, deg);
  const sagging = findPatches(mesh, steep)
    .filter((patch) => patch.size >= MIN_OVERHANG_MM2 && !heldUp(mesh, steep, onBed, patch.faces))
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
    fix:
      `Change the design so no surface underneath leans more than ${mm(deg)} degrees from vertical; keep every named size. ` +
      `The biggest problem area is around x = ${mm(at[0])}, y = ${mm(at[1])}, z = ${mm(at[2])} mm.`,
    triangles: sagging.flatMap((patch) => patch.faces).sort((a, b) => a - b),
    at,
  };
}

function steepFaces(mesh: Mesh, onBed: Uint8Array, deg: number): Uint8Array {
  const limit = -Math.sin((Math.min(90, deg + OVERHANG_SLACK_DEG) * Math.PI) / 180);
  const steep = new Uint8Array(mesh.triangles);
  for (let t = 0; t < mesh.triangles; t++) {
    if (!mesh.skipped[t] && !onBed[t] && mesh.areas[t]! > 0 && mesh.normals[t * 3 + 2]! < limit) steep[t] = 1;
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
function heldUp(mesh: Mesh, steep: Uint8Array, onBed: Uint8Array, faces: number[]): boolean {
  const walls = holdingEdges(mesh, steep, onBed, faces);
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

// Edges of the patch whose neighbour is on the bed or goes down from the edge. Six numbers per edge.
function holdingEdges(mesh: Mesh, steep: Uint8Array, onBed: Uint8Array, faces: number[]): number[] {
  const p = mesh.positions;
  const walls: number[] = [];
  for (const t of faces) {
    for (let side = 0; side < 3; side++) {
      const edge = mesh.edges.ofSide[t * 3 + side]!;
      const other = across(mesh.edges, edge, t);
      if (other === -1 || steep[other]) continue;
      const i = t * 9 + side * 3;
      const j = t * 9 + ((side + 1) % 3) * 3;
      if (onBed[other] || goesBelow(p, other, Math.min(p[i + 2]!, p[j + 2]!) - SUPPORT_DROP_MM)) {
        walls.push(p[i]!, p[i + 1]!, p[i + 2]!, p[j]!, p[j + 1]!, p[j + 2]!);
      }
    }
  }
  return walls;
}

function goesBelow(p: Float32Array, t: number, z: number): boolean {
  return p[t * 9 + 2]! < z || p[t * 9 + 5]! < z || p[t * 9 + 8]! < z;
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

// The patch's centre, moved onto the plane of the triangle nearest to it so the marker sits on the surface.
function centre(mesh: Mesh, patch: Patch): Vec3 {
  const c: Vec3 = [patch.sum[0] / patch.size, patch.sum[1] / patch.size, patch.sum[2] / patch.size];
  const p = mesh.positions;
  let nearest = patch.faces[0]!;
  let best = Infinity;
  for (const t of patch.faces) {
    let d = 0;
    for (let k = 0; k < 3; k++) d += ((p[t * 9 + k]! + p[t * 9 + 3 + k]! + p[t * 9 + 6 + k]!) / 3 - c[k]!) ** 2;
    if (d < best) {
      best = d;
      nearest = t;
    }
  }
  const n = mesh.normals;
  const o = nearest * 9;
  const off = (c[0] - p[o]!) * n[nearest * 3]! + (c[1] - p[o + 1]!) * n[nearest * 3 + 1]! + (c[2] - p[o + 2]!) * n[nearest * 3 + 2]!;
  return [c[0] - off * n[nearest * 3]!, c[1] - off * n[nearest * 3 + 1]!, c[2] - off * n[nearest * 3 + 2]!];
}
