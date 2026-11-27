import type { Rng } from '../rng.ts';
import type { Feature, Tree } from '../tree.ts';
import { holeRoom, placeOn } from './pick.ts';

export const cornerPlate = {
  id: 'corner_plate',
  length: [40, 120],
  arm: [12, 30],
  thickness: [2.5, 5],
  holes: [3, 3.5, 4, 4.5, 5],
  patterns: ['pair', 'pair', 'row', 'center'] as const,
  countersink: 0.5,
} as const;

export function sampleCornerPlate(rng: Rng): Tree {
  const f = cornerPlate;
  const arm = rng.size(f.arm[0], f.arm[1]);
  const length = rng.size(Math.max(f.length[0], arm + 25), f.length[1]);
  const thickness = rng.size(f.thickness[0], f.thickness[1], 0.5);
  const d = rng.pick(f.holes);
  const countersink = thickness >= d / 2 + 1.5 && rng.chance(f.countersink);
  const room = holeRoom(d, countersink);
  const features: Feature[] = [];
  // the same holes on both arms, from just past the corner square out to the end
  const place = arm >= 2 * room + 1 ? placeOn(rng, rng.pick(f.patterns), length - arm - 1.6, arm, room) : undefined;
  if (place) {
    features.push({ kind: 'holes', face: 'arm1', d, countersink, place });
    features.push({ kind: 'holes', face: 'arm2', d, countersink, place: structuredClone(place) });
  }
  return { family: f.id, body: { kind: 'corner', length, arm, thickness }, features };
}
