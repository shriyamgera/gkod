import type { Rng } from '../rng.ts';
import type { Feature, Tree } from '../tree.ts';
import { fit } from './pick.ts';

export const divider = {
  id: 'divider',
  width: [40, 160],
  // its height once it stands in the bin
  depth: [25, 80],
  thickness: [2, 3],
  round: 0.6,
  notch: 0.85,
  // a narrow slot halfway down, so two dividers cross, instead of a finger notch
  crossing: 0.3,
} as const;

export function sampleDivider(rng: Rng): Tree {
  const f = divider;
  const width = rng.size(f.width[0], f.width[1]);
  const depth = rng.size(f.depth[0], f.depth[1]);
  const thickness = rng.size(f.thickness[0], f.thickness[1], 0.5);
  const round = rng.chance(f.round);
  const cornerSize = round ? rng.size(2, Math.min(8, Math.floor(depth / 6)), 0.5) : 0;
  const features: Feature[] = [];
  if (rng.chance(f.notch)) {
    if (rng.chance(f.crossing)) {
      // a little wider than the divider it takes
      features.push({ kind: 'notch', width: Math.ceil(thickness + 0.5), depth: Math.round(depth / 2) });
    } else {
      const notchWidth = fit(rng, 20, Math.min(50, width / 2 - cornerSize - 4));
      if (notchWidth !== undefined) features.push({ kind: 'notch', width: notchWidth, depth: rng.size(5, Math.max(5, Math.min(15, Math.floor(depth / 3)))) });
    }
  }
  return { family: f.id, body: { kind: 'plate', width, depth, thickness, corner: round ? 'round' : 'sharp', cornerSize }, features };
}
