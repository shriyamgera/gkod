import type { Rng } from '../rng.ts';
import type { Feature, Tree } from '../tree.ts';
import { screwHoles } from './pick.ts';

export const cup = {
  id: 'cup',
  sides: [0, 0, 0, 6, 8] as const,
  diameter: [50, 100],
  height: [60, 120],
  wall: [1.6, 3],
  floor: [2, 3],
  // a few holes in the bottom, to drain it or to screw it down
  holes: 0.3,
} as const;

export function sampleCup(rng: Rng): Tree {
  const f = cup;
  const sides = rng.pick(f.sides);
  const diameter = rng.size(f.diameter[0], f.diameter[1]);
  const height = rng.size(f.height[0], f.height[1]);
  const wall = rng.size(f.wall[0], f.wall[1], 0.2);
  const floor = rng.size(f.floor[0], f.floor[1], 0.2);
  const features: Feature[] = [];
  if (rng.chance(f.holes)) {
    // the holes stay inside the square that fits in the floor
    const flat = sides ? Math.cos(Math.PI / sides) : 1;
    const inner = diameter - (2 * wall) / flat;
    const square = (2 * ((inner / 2) * flat)) / Math.SQRT2;
    const holes = screwHoles(rng, 'floor', ['center', 'grid'], square, square, floor, 0, 6);
    if (holes) features.push(holes);
  }
  return { family: f.id, body: { kind: 'cup', diameter, height, wall, floor, sides }, features };
}
