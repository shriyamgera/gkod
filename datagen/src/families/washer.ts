import type { Rng } from '../rng.ts';
import type { Feature, Tree } from '../tree.ts';

export const washer = {
  id: 'washer',
  // clearance holes for M3 to M10 bolts
  bores: [3.5, 4.5, 5.5, 6.5, 8.5, 9, 10.5],
  thickness: [1, 2.5],
  diameterMax: 60,
  slit: 0.3,
} as const;

export function sampleWasher(rng: Rng): Tree {
  const f = washer;
  const bore = rng.pick(f.bores);
  // from a plain washer, a little under twice its hole across, up to a wide fender washer
  const diameter = rng.size(Math.ceil(1.8 * bore + 2), Math.min(f.diameterMax, Math.floor(3.5 * bore + 6)), 0.5);
  const height = rng.size(f.thickness[0], f.thickness[1], 0.5);
  const features: Feature[] = rng.chance(f.slit) ? [{ kind: 'slit' }] : [];
  return { family: f.id, body: { kind: 'round', diameter, height, bore, hex: false }, features };
}
