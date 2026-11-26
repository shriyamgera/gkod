import type { Rng } from '../rng.ts';
import type { Feature, Tree } from '../tree.ts';
import { screwHoles } from './pick.ts';

export const hook = {
  id: 'hook',
  width: [10, 30],
  thickness: [4, 7],
  reach: [15, 45],
  tipMore: [4, 20],
  plate: [60, 120],
  holes: 0.9,
  patterns: ['pair', 'pair', 'center'] as const,
  countersink: 0.6,
} as const;

export function sampleHook(rng: Rng): Tree {
  const f = hook;
  const width = rng.size(f.width[0], f.width[1]);
  const thickness = rng.size(f.thickness[0], f.thickness[1], 0.5);
  const reach = rng.size(f.reach[0], f.reach[1]);
  const tip = rng.size(Math.ceil(thickness) + f.tipMore[0], Math.ceil(thickness) + f.tipMore[1]);
  const plate = rng.size(f.plate[0], f.plate[1]);
  const features: Feature[] = [];
  if (rng.chance(f.holes)) {
    const start = Math.max(tip, thickness + reach * 0.4) + 1;
    const holes = screwHoles(rng, 'plate', f.patterns, plate - start, width, thickness, f.countersink, 5);
    if (holes) features.push(holes);
  }
  return { family: f.id, body: { kind: 'hook', width, plate, reach, tip, thickness }, features };
}
