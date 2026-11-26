import type { Rng } from '../rng.ts';
import type { Feature, Tree } from '../tree.ts';

export const clip = {
  id: 'clip',
  cable: [4, 20],
  wall: [1.6, 3],
  length: [8, 25],
  padThickness: [2, 4],
  holes: 0.4,
} as const;

export function sampleClip(rng: Rng): Tree {
  const f = clip;
  const cable = rng.size(f.cable[0], f.cable[1], 0.5);
  const wall = rng.size(f.wall[0], f.wall[1], 0.2);
  const grip = rng.size(0.5, Math.min(3, Math.floor(cable) / 2), 0.5);
  const length = rng.size(f.length[0], f.length[1]);
  const padThickness = rng.size(f.padThickness[0], f.padThickness[1], 0.5);
  const ring = cable + 2 * wall;
  const features: Feature[] = [];
  let pad = rng.size(Math.ceil(ring) + 2, Math.ceil(ring) + 16);
  if (length >= 10 && rng.chance(f.holes)) {
    const d = rng.pick([3, 3.5, 4]);
    const spacing = Math.ceil(ring + d + 2 * 1.6 + 2) + rng.int(0, 6);
    pad = Math.max(pad, Math.ceil(spacing + d + 2 * 1.6 + 2));
    features.push({ kind: 'holes', face: 'pad', d, countersink: false, place: { pattern: 'pair', spacing } });
  }
  return { family: f.id, body: { kind: 'clip', cable, wall, grip, length, pad, padThickness }, features };
}
