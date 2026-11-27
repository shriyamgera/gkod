import type { Rng } from '../rng.ts';
import type { Feature, Tree } from '../tree.ts';
import { screwHoles } from './pick.ts';

export const comb = {
  id: 'comb',
  // the cable each slot takes
  slot: [3, 12],
  slots: [3, 10],
  // the solid finger between two slots
  finger: [4, 8],
  slotDepth: [8, 25],
  // the strip behind the slots
  spine: [12, 25],
  thickness: [3, 6],
  holes: 0.85,
  patterns: ['pair', 'pair', 'row', 'center'] as const,
  countersink: 0.4,
} as const;

export function sampleComb(rng: Rng): Tree {
  const f = comb;
  const slot = rng.size(f.slot[0], f.slot[1], 0.5);
  const finger = rng.size(f.finger[0], f.finger[1], 0.5);
  // as many slots as fit in a 200 mm comb
  const slots = rng.int(f.slots[0], Math.min(f.slots[1], Math.floor(190 / (slot + finger))));
  const width = Math.ceil(slots * (slot + finger));
  const slotDepth = rng.size(Math.max(f.slotDepth[0], Math.ceil(slot) + 2), Math.max(f.slotDepth[1], Math.ceil(slot) + 2));
  const spine = rng.size(f.spine[0], f.spine[1]);
  const thickness = rng.size(f.thickness[0], f.thickness[1], 0.5);
  const features: Feature[] = [];
  if (rng.chance(f.holes)) {
    const holes = screwHoles(rng, 'spine', f.patterns, width, spine, thickness, f.countersink, 5);
    if (holes) features.push(holes);
  }
  return { family: f.id, body: { kind: 'comb', width, depth: slotDepth + spine, thickness, slots, slot, slotDepth }, features };
}
