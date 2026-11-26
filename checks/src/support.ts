import { SUPPORT_DROP_MM, WALL_PIECE_MM } from '#checks/limits';
import { across, type Mesh } from '#checks/mesh';
import type { Patch } from '#checks/patches';
import { type DownRays, downRays } from '#checks/rays';

/** Numbers per wall: the two ends of an edge that holds a patch up, then the reach already used below that edge. */
export const WALL = 7;

export type Support = {
  /** The walls that hold patch i up. A wall that stands on the bed has used no reach. */
  walls(i: number): number[];
  /** How far a point is from support: to the nearest wall of patch i, plus the reach that wall has already used. */
  reachAt(i: number, x: number, y: number, z: number): number;
};

// How far inside the solid a ray down starts, in mm: well above float rounding, well below any real feature.
const INSIDE_MM = 1e-3;

// A walk down the surface that takes more steps than this goes round in circles, and counts as held.
const MAX_STEPS = 256;

/**
 * Finds what holds each patch up. A wall only holds a patch up as well as the wall is held up itself:
 * one that hangs from another overhang carries on the reach that overhang has already used, less the height it rises.
 */
export function findSupport(mesh: Mesh, steep: Uint8Array, resting: Uint8Array, patches: Patch[]): Support {
  const p = mesh.positions;
  const n = mesh.normals;
  const patchOf = new Int32Array(mesh.triangles).fill(-1);
  patches.forEach((patch, i) => {
    for (const t of patch.faces) patchOf[t] = i;
  });
  const found: (number[] | undefined)[] = [];
  const measuring = new Uint8Array(patches.length);
  let rays: DownRays | undefined;
  // the patch whose walls are being found, and where a walk down from one of them came back to that same patch
  let current = -1;
  let backAt: [number, number, number, number] | null = null;

  function walls(i: number): number[] {
    const done = found[i];
    if (done) return done;
    // patches that hold each other up in a circle hold nothing
    if (measuring[i]) return [];
    measuring[i] = 1;
    const outer = current;
    current = i;
    const out: number[] = [];
    // walls that hang from this same patch, as a countersink hangs from the top of its hole: [index in out, x, y, z, rise]
    const hanging: number[] = [];
    for (const t of patches[i]!.faces) {
      for (let side = 0; side < 3; side++) {
        const other = across(mesh.edges, mesh.edges.ofSide[t * 3 + side]!, t);
        if (other === -1 || steep[other]) continue;
        const a = t * 9 + side * 3;
        const b = t * 9 + ((side + 1) % 3) * 3;
        if (resting[other]) out.push(p[a]!, p[a + 1]!, p[a + 2]!, p[b]!, p[b + 1]!, p[b + 2]!, 0);
        else if (goesDown(p, other, a, b) || topInCorner(mesh, t, other, a)) addPieces(out, hanging, other, a, b);
      }
    }
    settle(out, hanging);
    current = outer;
    measuring[i] = 0;
    found[i] = out;
    return out;
  }

  // A long edge is measured in pieces, since what holds it up can change along it.
  function addPieces(out: number[], hanging: number[], other: number, a: number, b: number) {
    const dx = p[b]! - p[a]!, dy = p[b + 1]! - p[a + 1]!, dz = p[b + 2]! - p[a + 2]!;
    const count = Math.max(1, Math.ceil(Math.hypot(dx, dy, dz) / WALL_PIECE_MM));
    for (let k = 0; k < count; k++) {
      const s = k / count, e = (k + 1) / count, m = (k + 0.5) / count;
      backAt = null;
      const used = below(other, p[a]! + m * dx, p[a + 1]! + m * dy, p[a + 2]! + m * dz);
      if (backAt) hanging.push(out.length + 6, ...(backAt as [number, number, number, number]));
      out.push(p[a]! + s * dx, p[a + 1]! + s * dy, p[a + 2]! + s * dz, p[a]! + e * dx, p[a + 1]! + e * dy, p[a + 2]! + e * dz, used);
    }
  }

  // A wall that hangs from its own patch has used the reach of the point it hangs from, measured from the patch's other walls.
  function settle(out: number[], hanging: number[]) {
    for (let round = 0; round < 4; round++) {
      let changed = false;
      for (let h = 0; h < hanging.length; h += 5) {
        const at = hanging[h]!;
        let best = Infinity;
        for (let o = 0; o < out.length; o += WALL) {
          if (o + 6 !== at) best = Math.min(best, out[o + 6]! + Math.sqrt(distanceSq(out, o, hanging[h + 1]!, hanging[h + 2]!, hanging[h + 3]!)));
        }
        best = Math.max(0, best - hanging[h + 4]!);
        if (best < out[at]!) {
          out[at] = best;
          changed = true;
        }
      }
      if (!changed) return;
    }
  }

  function reachAt(i: number, x: number, y: number, z: number): number {
    const list = walls(i);
    let best = Infinity;
    for (let o = 0; o < list.length; o += WALL) best = Math.min(best, list[o + 6]! + Math.sqrt(distanceSq(list, o, x, y, z)));
    return best;
  }

  // The reach already used at a point on a face that holds something up: 0 on the bed, or the reach of the overhang
  // the face hangs from, less how far the wall rises from it (a 45 degree slope may reach out as far as it rises).
  // It follows walls down, and goes straight down through solid.
  function below(face: number, x: number, y: number, z: number): number {
    const top = z;
    let from = -1;
    for (let step = 0; step < MAX_STEPS; step++) {
      if (resting[face]) return 0;
      if (steep[face]) {
        if (patchOf[face] !== current) return Math.max(0, reachAt(patchOf[face]!, x, y, z) - (top - z));
        backAt = [x, y, z, top - z];
        return Infinity;
      }
      const nx = n[face * 3]!, ny = n[face * 3 + 1]!, nz = n[face * 3 + 2]!;
      if (nz > 0) {
        // solid lies under a face that looks up: go straight down through it to the face where it ends
        rays ??= downRays(mesh);
        x -= INSIDE_MM * nx;
        y -= INSIDE_MM * ny;
        const hit = rays.below(x, y, z - INSIDE_MM * nz - INSIDE_MM);
        if (!hit || n[hit.face * 3 + 2]! >= 0) return 0;
        from = -1;
        face = hit.face;
        z = hit.z;
      } else {
        const next = walkDown(mesh, face, from, x, y, z);
        if (!next) return 0;
        from = face;
        [face, x, y, z] = next;
      }
    }
    return 0;
  }

  // lowest patches first, so a patch higher up finds the reach of the ones below already measured
  const byHeight = patches.map((_, i) => i).sort((a, b) => patches[a]!.lowest - patches[b]!.lowest);
  for (const i of byHeight) walls(i);
  return { walls, reachAt };
}

// Follows a wall the steepest way down to where that line leaves the triangle. Returns the face across that side and the point.
function walkDown(mesh: Mesh, t: number, from: number, x: number, y: number, z: number): [number, number, number, number] | null {
  const p = mesh.positions;
  const nx = mesh.normals[t * 3]!, ny = mesh.normals[t * 3 + 1]!, nz = mesh.normals[t * 3 + 2]!;
  const dx = nx * nz, dy = ny * nz, dz = nz * nz - 1;
  const o = t * 9;
  const ux = p[o + 3]! - p[o]!, uy = p[o + 4]! - p[o + 1]!, uz = p[o + 5]! - p[o + 2]!;
  const vx = p[o + 6]! - p[o]!, vy = p[o + 7]! - p[o + 1]!, vz = p[o + 8]! - p[o + 2]!;
  const uu = ux * ux + uy * uy + uz * uz, uv = ux * vx + uy * vy + uz * vz, vv = vx * vx + vy * vy + vz * vz;
  const det = uu * vv - uv * uv;
  if (!(det > 1e-12)) return null;
  // weights of the second and third corners for a point, or for a direction
  const weights = (qx: number, qy: number, qz: number): [number, number] => {
    const qu = qx * ux + qy * uy + qz * uz, qv = qx * vx + qy * vy + qz * vz;
    return [(vv * qu - uv * qv) / det, (uu * qv - uv * qu) / det];
  };
  const [b, c] = weights(x - p[o]!, y - p[o + 1]!, z - p[o + 2]!);
  const [db, dc] = weights(dx, dy, dz);
  const at = [1 - b - c, b, c];
  const rate = [-db - dc, db, dc];
  // the line leaves through the side across from the first corner whose weight falls to zero
  const exits = [0, 1, 2]
    .filter((k) => rate[k]! < -1e-12)
    .map((k) => ({ k, s: Math.max(0, at[k]!) / -rate[k]! }))
    .sort((m, q) => m.s - q.s);
  for (const { k, s } of exits) {
    const edge = mesh.edges.ofSide[t * 3 + ((k + 1) % 3)]!;
    const next = edge === -1 ? -1 : across(mesh.edges, edge, t);
    if (next === from && s < 1e-9) continue;
    if (next === -1) return null;
    return [next, x + s * dx, y + s * dy, z + s * dz];
  }
  return null;
}

// True when a corner of triangle t is below the edge from corner a to corner b, measured at the nearest point of the edge.
function goesDown(p: Float32Array, t: number, a: number, b: number): boolean {
  const dx = p[b]! - p[a]!, dy = p[b + 1]! - p[a + 1]!, dz = p[b + 2]! - p[a + 2]!;
  const length = dx * dx + dy * dy + dz * dz;
  for (let c = t * 9; c < t * 9 + 9; c += 3) {
    let k = length > 0 ? ((p[c]! - p[a]!) * dx + (p[c + 1]! - p[a + 1]!) * dy + (p[c + 2]! - p[a + 2]!) * dz) / length : 0;
    k = Math.max(0, Math.min(1, k));
    if (p[c + 2]! < p[a + 2]! + k * dz - SUPPORT_DROP_MM) return true;
  }
  return false;
}

// True when triangle t faces up and a corner of it lies in front of face f, so the edge between them is an inside corner,
// as where a ball or a rod lying down joins a plate.
function topInCorner(mesh: Mesh, f: number, t: number, a: number): boolean {
  const n = mesh.normals;
  if (n[t * 3 + 2]! <= 0) return false;
  const p = mesh.positions;
  const nx = n[f * 3]!, ny = n[f * 3 + 1]!, nz = n[f * 3 + 2]!;
  for (let c = t * 9; c < t * 9 + 9; c += 3) {
    if (nx * (p[c]! - p[a]!) + ny * (p[c + 1]! - p[a + 1]!) + nz * (p[c + 2]! - p[a + 2]!) > SUPPORT_DROP_MM) return true;
  }
  return false;
}

/** Squared distance from a point to the wall edge that starts at index o. */
export function distanceSq(s: number[], o: number, x: number, y: number, z: number): number {
  const dx = s[o + 3]! - s[o]!, dy = s[o + 4]! - s[o + 1]!, dz = s[o + 5]! - s[o + 2]!;
  const length = dx * dx + dy * dy + dz * dz;
  let k = length > 0 ? ((x - s[o]!) * dx + (y - s[o + 1]!) * dy + (z - s[o + 2]!) * dz) / length : 0;
  k = Math.max(0, Math.min(1, k));
  const ex = s[o]! + k * dx - x, ey = s[o + 1]! + k * dy - y, ez = s[o + 2]! + k * dz - z;
  return ex * ex + ey * ey + ez * ez;
}
