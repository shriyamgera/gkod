import type { Rng } from '../rng.ts';
import type { Feature, Tree } from '../tree.ts';
import { fit } from './pick.ts';

export const enclosure = {
  id: 'enclosure',
  width: [50, 160],
  depth: [40, 120],
  height: [15, 50],
  wall: [1.6, 3],
  floor: [2, 3],
  round: 0.6,
  // standoffs for a circuit board, screwed from below
  bossD: [5, 8],
  bossHoles: [2.5, 3],
  tabs: 0.3,
} as const;

export function sampleEnclosure(rng: Rng): Tree {
  const f = enclosure;
  const width = rng.size(f.width[0], f.width[1]);
  const depth = rng.size(f.depth[0], f.depth[1]);
  const height = rng.size(f.height[0], f.height[1]);
  const wall = rng.size(f.wall[0], f.wall[1], 0.2);
  const floor = rng.size(f.floor[0], f.floor[1], 0.2);
  const round = rng.chance(f.round);
  const cornerSize = round ? rng.size(2, Math.max(2, Math.min(8, Math.floor(Math.min(width, depth) / 8))), 0.5) : 0;
  const features: Feature[] = [];
  const hole = rng.pick(f.bossHoles);
  // a standoff has a 1.6 mm wall round its hole
  const d = rng.size(Math.max(f.bossD[0], Math.ceil((hole + 3.2) * 2) / 2), f.bossD[1], 0.5);
  const [inW, inD] = [width - 2 * wall, depth - 2 * wall];
  // the standoffs stay clear of the walls and of the rounded inside corners
  const keep = d + 2 * cornerSize + 2;
  const x = fit(rng, Math.max(d + 4, inW * 0.4), inW - keep);
  const y = fit(rng, Math.max(d + 4, inD * 0.4), inD - keep);
  const tallest = Math.min(10, height - floor - 2);
  if (x !== undefined && y !== undefined && tallest >= 3) {
    features.push({ kind: 'bosses', d, height: rng.size(3, tallest, 0.5), hole, place: { pattern: 'grid', x, y } });
  }
  if (rng.chance(f.tabs)) {
    const tabHole = rng.pick([3, 3.5, 4, 4.5]);
    const tabWidth = fit(rng, tabHole + 5, Math.min(20, depth - 2 * cornerSize - 4));
    if (tabWidth !== undefined) {
      const length = rng.size(Math.ceil(tabWidth / 2 + tabHole / 2 + 2.5), Math.ceil(tabWidth / 2 + tabHole / 2 + 8));
      features.push({ kind: 'tabs', length, width: tabWidth, thickness: rng.size(2, Math.min(4, height), 0.5), hole: tabHole });
    }
  }
  return { family: f.id, body: { kind: 'box', width, depth, height, wall, floor, corner: round ? 'round' : 'sharp', cornerSize }, features };
}
