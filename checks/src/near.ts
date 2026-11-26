import { MAX_REACH_MM } from '#checks/limits';
import { distanceSq, WALL } from '#checks/support';
import type { Vec3 } from '#checks/types';

/** Finds a wall within reach of a point: within 5 mm, less the reach the wall has already used. */
export type NearWall = (x: number, y: number, z: number) => boolean;

/**
 * Sorts the walls into cubes as wide as the reach, so a point only measures the walls in the 27 cubes around it.
 * Walls whose reach is used up are left out.
 */
export function nearWall(walls: number[], min: Vec3): NearWall {
  const size = MAX_REACH_MM;
  const cube = (value: number, k: number) => Math.floor((value - min[k]!) / size);
  const key = (i: number, j: number, k: number) => `${i} ${j} ${k}`;
  const cubes = new Map<string, number[]>();
  for (let o = 0; o < walls.length; o += WALL) {
    if (walls[o + 6]! >= MAX_REACH_MM) continue;
    const lo = [0, 1, 2].map((k) => cube(Math.min(walls[o + k]!, walls[o + 3 + k]!), k));
    const hi = [0, 1, 2].map((k) => cube(Math.max(walls[o + k]!, walls[o + 3 + k]!), k));
    for (let i = lo[0]!; i <= hi[0]!; i++) {
      for (let j = lo[1]!; j <= hi[1]!; j++) {
        for (let k = lo[2]!; k <= hi[2]!; k++) {
          const list = cubes.get(key(i, j, k));
          if (list) list.push(o);
          else cubes.set(key(i, j, k), [o]);
        }
      }
    }
  }

  const within = (o: number, x: number, y: number, z: number) => {
    const left = MAX_REACH_MM - walls[o + 6]!;
    return distanceSq(walls, o, x, y, z) <= left * left;
  };
  // the last wall found, since neighbouring points share walls
  let last = -1;
  return (x, y, z) => {
    if (last >= 0 && within(last, x, y, z)) return true;
    const i = cube(x, 0), j = cube(y, 1), k = cube(z, 2);
    for (let di = -1; di <= 1; di++) {
      for (let dj = -1; dj <= 1; dj++) {
        for (let dk = -1; dk <= 1; dk++) {
          for (const o of cubes.get(key(i + di, j + dj, k + dk)) ?? []) {
            if (within(o, x, y, z)) {
              last = o;
              return true;
            }
          }
        }
      }
    }
    return false;
  };
}
