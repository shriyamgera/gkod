import type { Rng } from '../rng.ts';
import type { Feature, Tree } from '../tree.ts';
import { fit } from './pick.ts';

export const handle = {
  id: 'handle',
  // the usual hole spacings for drawer pulls, and sometimes any spacing
  spacings: [64, 76, 96, 128, 160],
  standard: 0.7,
  spacing: [60, 160],
  post: [8, 14],
  grip: [7, 12],
  // the room for fingers under the bar
  clearance: [16, 26],
  overhang: [2, 30],
  width: [10, 20],
  screws: [3, 3.5, 4],
  grooves: 0.35,
} as const;

export function sampleHandle(rng: Rng): Tree {
  const f = handle;
  const spacing = rng.chance(f.standard) ? rng.pick(f.spacings) : rng.size(f.spacing[0], f.spacing[1]);
  const post = rng.size(f.post[0], f.post[1], 0.5);
  const grip = rng.size(f.grip[0], f.grip[1], 0.5);
  const height = Math.ceil(grip + rng.size(f.clearance[0], f.clearance[1]));
  // the bar runs on past each post by an equal amount
  const length = Math.min(200, Math.ceil(spacing + post + grip) + 2 * rng.size(1, f.overhang[1] / 2));
  const width = rng.size(f.width[0], f.width[1]);
  const screw = rng.pick(f.screws);
  const screwDepth = rng.size(8, Math.min(16, height - 2), 0.5);
  const features: Feature[] = [];
  if (rng.chance(f.grooves)) {
    const d = fit(rng, 6, Math.min(14, 2 * (grip - 4)), 0.5);
    if (d !== undefined) {
      const most = Math.floor((spacing - post - 4 - d) / (1.5 * d)) + 1;
      if (most >= 3) features.push({ kind: 'grooves', count: rng.int(3, Math.min(6, most)), d });
    }
  }
  return { family: f.id, body: { kind: 'handle', spacing, length, height, grip, post, width, screw, screwDepth }, features };
}
