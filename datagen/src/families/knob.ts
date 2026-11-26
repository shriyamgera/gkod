import type { Rng } from '../rng.ts';
import type { Feature, Tree } from '../tree.ts';
import { fit } from './pick.ts';

export const knob = {
  id: 'knob',
  diameter: [15, 50],
  height: [8, 25],
  shafts: [3, 4, 5, 6, 8],
  grips: 0.75,
  flat: 0.3,
} as const;

export function sampleKnob(rng: Rng): Tree {
  const f = knob;
  const diameter = rng.size(f.diameter[0], f.diameter[1]);
  const height = rng.size(f.height[0], f.height[1], 0.5);
  const shaft = rng.pick(f.shafts.filter((s) => s <= diameter / 2 - 4));
  const shaftDepth = rng.size(5, height - 2, 0.5);
  const chamfer = rng.size(0.5, Math.max(0.5, Math.min(2, Math.floor((height / 3) * 2) / 2, Math.floor((diameter / 6) * 2) / 2)), 0.5);
  const features: Feature[] = [];
  if (rng.chance(f.grips)) {
    const d = fit(rng, 2, Math.min(5, diameter / 2 - shaft / 2 - 3.5), 0.5);
    if (d !== undefined) {
      const most = Math.floor((diameter * Math.PI) / (d + 2.5));
      if (most >= 8) features.push({ kind: 'grips', count: rng.int(Math.max(6, Math.floor(most / 2)), Math.min(30, most)), d });
    }
  }
  if (rng.chance(f.flat)) {
    const depth = fit(rng, 0.5, shaft / 3 - 0.3, 0.5);
    if (depth !== undefined) features.push({ kind: 'flat', depth });
  }
  return { family: f.id, body: { kind: 'knob', diameter, height, shaft, shaftDepth, chamfer }, features };
}
