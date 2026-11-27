import type { Rng } from '../rng.ts';
import type { Feature, Tree } from '../tree.ts';

export const foot = {
  id: 'foot',
  diameter: [12, 50],
  // the top is from a little over half the base up to the full base
  top: [0.55, 1],
  height: [4, 25],
  tallest: 0.75,
  hole: 0.8,
  holes: [3, 3.5, 4, 4.5, 5],
} as const;

export function sampleFoot(rng: Rng): Tree {
  const f = foot;
  const diameter = rng.size(f.diameter[0], f.diameter[1]);
  const top = rng.size(Math.max(6, Math.ceil(diameter * f.top[0])), diameter);
  // squat, so it reads as a foot and not a leg
  const height = rng.size(f.height[0], Math.max(f.height[0], Math.min(f.height[1], Math.floor(diameter * f.tallest))), 0.5);
  const features: Feature[] = [];
  if (rng.chance(f.hole)) {
    // a screw goes down the middle with its head sunk into the top, where the foot meets the floor
    const fits = f.holes.filter((hole) => top / 2 >= hole / 2 + 2.6);
    if (fits.length) {
      const d = rng.pick(fits);
      const countersink = top / 2 >= d + 2.6 && height >= d / 2 + 1.5;
      features.push({ kind: 'holes', face: 'top', d, countersink, place: { pattern: 'center' } });
    }
  }
  return { family: f.id, body: { kind: 'foot', diameter, top, height }, features };
}
