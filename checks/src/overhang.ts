import { mm, mm2 } from '#checks/format';
import { MAX_REACH_MM, MAX_REACH_SAMPLES, MIN_OVERHANG_MM2, NEAR_BED_MM, OVERHANG_TOLERANCE_DEG } from '#checks/limits';
import type { Mesh } from '#checks/mesh';
import { findPatches, type Patch } from '#checks/patches';
import { distanceSq, findSupport, WALL } from '#checks/support';
import type { CheckResult, Vec3 } from '#checks/types';

const title = 'No steep overhangs';

// Corner weights for the points a patch is sampled at: corners, edge middles and the centre of each triangle.
const samples = [
  [1, 0, 0], [0, 1, 0], [0, 0, 1],
  [0.5, 0.5, 0], [0, 0.5, 0.5], [0.5, 0, 0.5],
  [1 / 3, 1 / 3, 1 / 3],
] as const;

/**
 * Finds faces underneath that lean more than `deg` from vertical, groups them into patches by shared edges,
 * and fails patches that nothing holds up, and patches big enough to matter that reach too far from what holds them up.
 */
export function checkOverhang(mesh: Mesh, onBed: Uint8Array, deg: number): CheckResult {
  const resting = restingFaces(mesh, onBed);
  const steep = steepFaces(mesh, resting, deg);
  const patches = findPatches(mesh, steep);
  const support = findSupport(mesh, steep, resting, patches);
  const sagging = patches.filter((patch, i) => sags(mesh, patch, support.walls(i))).sort((a, b) => b.size - a.size);
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

// A patch that nothing holds up within reach, such as the bottom of a piece floating in the air, would start
// printing in mid-air however small it is. Any other patch sags when it is big enough and reaches too far.
function sags(mesh: Mesh, patch: Patch, walls: number[]): boolean {
  const holding: number[] = [];
  for (let o = 0; o < walls.length; o += WALL) {
    if (walls[o + 6]! < MAX_REACH_MM) holding.push(...walls.slice(o, o + WALL));
  }
  if (holding.length === 0) return true;
  return patch.size >= MIN_OVERHANG_MM2 && !heldUp(mesh, holding, patch.faces);
}

// True when every sampled point of the patch is within reach of an edge where a wall below holds it up.
function heldUp(mesh: Mesh, walls: number[], faces: number[]): boolean {
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

// Index of a wall within reach of the point, or -1: within 5 mm, less the reach the wall has already used.
// Starts at the last hit, since neighbouring points share walls.
function nearWall(walls: number[], x: number, y: number, z: number, hint: number): number {
  const count = walls.length / WALL;
  for (let k = 0; k < count; k++) {
    const w = (hint + k) % count;
    const left = MAX_REACH_MM - walls[w * WALL + 6]!;
    if (distanceSq(walls, w * WALL, x, y, z) <= left * left) return w;
  }
  return -1;
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
