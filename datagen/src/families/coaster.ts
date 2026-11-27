import type { Rng } from '../rng.ts';
import type { Feature, Tree } from '../tree.ts';

export const coaster = {
  id: 'coaster',
  round: 0.6,
  size: [80, 110],
  thickness: [3, 5],
  // a low raised edge that keeps drips on the coaster
  rim: 0.85,
  rimHeight: [1, 2.5],
  rimWall: [1.6, 3],
} as const;

export function sampleCoaster(rng: Rng): Tree {
  const f = coaster;
  const round = rng.chance(f.round);
  const size = rng.size(f.size[0], f.size[1]);
  const thickness = rng.size(f.thickness[0], f.thickness[1], 0.5);
  const features: Feature[] = [];
  // a plain disc would have only two sizes, so a round coaster always has its rim
  if (round || rng.chance(f.rim)) features.push({ kind: 'lip', height: rng.size(f.rimHeight[0], f.rimHeight[1], 0.5), wall: rng.size(f.rimWall[0], f.rimWall[1], 0.2) });
  if (round) return { family: f.id, body: { kind: 'disc', diameter: size, thickness }, features };
  // a square coaster always has its corners taken off
  const corner = rng.chance(0.75) ? 'round' : 'chamfer';
  return { family: f.id, body: { kind: 'plate', width: size, depth: size, thickness, corner, cornerSize: rng.size(5, 15, 0.5) }, features };
}
