import type { Mesh } from '#checks/mesh';
import { eachPoint, type Patch, SAMPLES } from '#checks/patches';
import { distanceSq, WALL } from '#checks/support';
import type { Vec3 } from '#checks/types';

// Points less than this much nearer to support than the farthest point count as just as far.
const TIE_MM = 0.5;

// At most this many wall distances are measured to place the marker, so a big area stays fast.
const MAX_WORK = 1_000_000;

/**
 * Where the "Would sag here" marker goes: the point of the area farthest from what holds it up, and of the points
 * about as far, the one nearest the middle. With nothing holding it up, the point nearest the middle.
 */
export function markPoint(mesh: Mesh, patch: Patch, walls: number[]): Vec3 {
  const middle = patch.sum.map((value) => value / patch.size) as Vec3;
  const points = candidates(mesh, patch, Math.max(64, Math.floor((MAX_WORK * WALL) / Math.max(1, walls.length))));
  const reach = points.map(([x, y, z]) => {
    let best = Infinity;
    for (let o = 0; o < walls.length; o += WALL) best = Math.min(best, walls[o + 6]! + Math.sqrt(distanceSq(walls, o, x, y, z)));
    return best;
  });
  const far = reach.reduce((a, b) => Math.max(a, b), -Infinity);
  let at = points[0]!;
  let nearest = Infinity;
  points.forEach((point, k) => {
    if (far < Infinity && reach[k]! < far - TIE_MM) return;
    const d = (point[0] - middle[0]) ** 2 + (point[1] - middle[1]) ** 2 + (point[2] - middle[2]) ** 2;
    if (d < nearest) {
      nearest = d;
      at = point;
    }
  });
  return at;
}

// The sampled points of the patch. For a big patch, one point per square of a grid seen from below:
// the one nearest the middle of its square, so the choice does not depend on the order of the faces.
function candidates(mesh: Mesh, patch: Patch, limit: number): Vec3[] {
  const all: Vec3[] = [];
  if (patch.faces.length * SAMPLES <= limit) {
    eachPoint(mesh, patch.faces, (x, y, z) => all.push([x, y, z]) > 0);
    return all;
  }
  const size = Math.sqrt(patch.size / limit) || 1;
  const kept = new Map<number, { point: Vec3; d: number }>();
  eachPoint(mesh, patch.faces, (x, y, z) => {
    const i = Math.floor(x / size), j = Math.floor(y / size);
    const d = (x - (i + 0.5) * size) ** 2 + (y - (j + 0.5) * size) ** 2;
    const key = (i + 2 ** 20) * 2 ** 21 + (j + 2 ** 20);
    const old = kept.get(key);
    if (!old || d < old.d) kept.set(key, { point: [x, y, z], d });
    return true;
  });
  for (const { point } of kept.values()) all.push(point);
  return all;
}
