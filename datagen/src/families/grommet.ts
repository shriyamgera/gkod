import type { Rng } from '../rng.ts';
import type { Tree } from '../tree.ts';

export const grommet = {
  id: 'grommet',
  // the hole in the desk it goes into
  diameter: [30, 80],
  height: [12, 30],
  wall: [1.6, 3],
  // how far the flange reaches past the hole, all round
  flange: [5, 12],
  flangeThickness: [2, 4],
  flangeHoles: 0.25,
} as const;

export function sampleGrommet(rng: Rng): Tree {
  const f = grommet;
  const diameter = rng.size(f.diameter[0], f.diameter[1]);
  const height = rng.size(f.height[0], f.height[1], 0.5);
  const wall = rng.size(f.wall[0], f.wall[1], 0.2);
  const thickness = rng.size(f.flangeThickness[0], f.flangeThickness[1], 0.5);
  if (rng.chance(f.flangeHoles)) {
    // screwed down through the flange, so it needs room for a screw beside the tube
    const hole = rng.pick([3, 3.5, 4]);
    const d = diameter + 2 * rng.size(Math.ceil(hole + 3.2 + 1), Math.ceil(hole + 3.2 + 6));
    return { family: f.id, body: { kind: 'sleeve', diameter, wall, height }, features: [{ kind: 'flange', d, thickness, holes: rng.pick([3, 4]), hole }] };
  }
  const d = diameter + 2 * rng.size(f.flange[0], f.flange[1]);
  return { family: f.id, body: { kind: 'sleeve', diameter, wall, height }, features: [{ kind: 'flange', d, thickness, holes: 0, hole: 0 }] };
}
