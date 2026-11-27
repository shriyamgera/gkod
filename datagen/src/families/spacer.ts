import type { Rng } from '../rng.ts';
import type { Feature, Tree } from '../tree.ts';
import { fit } from './pick.ts';

export const spacer = {
  id: 'spacer',
  diameter: [6, 30],
  height: [3, 50],
  bores: [2.5, 3, 3.5, 4, 4.5, 5, 5.5, 6, 8, 10],
  hex: 0.3,
  flange: 0.3,
  flangeHoles: [0, 2, 3, 4],
} as const;

export function sampleSpacer(rng: Rng): Tree {
  const f = spacer;
  const hex = rng.chance(f.hex);
  const bore = rng.pick(f.bores);
  // a tube around its screw: the wall is never thinner than 1.75 mm nor much thicker than the screw
  const diameter = rng.size(Math.max(f.diameter[0], bore + 3.5), Math.min(f.diameter[1], 2.5 * bore + 8), 0.5);
  const height = rng.size(f.height[0], f.height[1], 0.5);
  const features: Feature[] = [];
  if (height >= 5 && rng.chance(f.flange)) {
    const across = hex ? diameter / Math.cos(Math.PI / 6) : diameter;
    const holes = rng.pick(f.flangeHoles);
    const hole = rng.pick([3, 3.5, 4]);
    const least = holes ? across + 2 * (hole + 3.2) + 2 : across + 6;
    const d = fit(rng, least, least + 20);
    if (d !== undefined) {
      features.push({ kind: 'flange', d, thickness: rng.size(2, Math.min(5, height - 2), 0.5), holes, hole: holes ? hole : 0 });
    }
  }
  return { family: f.id, body: { kind: 'round', diameter, height, bore, hex }, features };
}
