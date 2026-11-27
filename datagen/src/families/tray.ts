import type { Rng } from '../rng.ts';
import type { Corner, Feature, Tree } from '../tree.ts';
import { fit, screwHoles } from './pick.ts';

export const tray = {
  id: 'tray',
  width: [30, 160],
  depth: [30, 120],
  height: [10, 60],
  wall: [1.6, 3],
  floor: [1.6, 3],
  corners: ['sharp', 'round', 'round', 'chamfer'] as Corner[],
  dividers: 0.4,
  holes: 0.3,
  patterns: ['corners', 'center', 'grid', 'row'] as const,
  tabs: 0.35,
} as const;

export function sampleTray(rng: Rng): Tree {
  const f = tray;
  const width = rng.size(f.width[0], f.width[1]);
  const depth = rng.size(f.depth[0], f.depth[1]);
  const height = rng.size(f.height[0], f.height[1]);
  const wall = rng.size(f.wall[0], f.wall[1], 0.2);
  const floor = rng.size(f.floor[0], f.floor[1], 0.2);
  const corner = rng.pick(f.corners);
  const cornerSize = corner === 'sharp' ? 0 : rng.size(2, Math.max(2, Math.min(10, Math.floor(Math.min(width, depth) / 6))), 0.5);
  const features: Feature[] = [];
  const pitchMost = Math.floor((depth - wall) / (Math.max(cornerSize + wall, wall + 8) + 1e-9)) - 1;
  if (pitchMost >= 1 && rng.chance(f.dividers)) {
    features.push({ kind: 'dividers', count: rng.int(1, Math.min(3, pitchMost)) });
  } else if (rng.chance(f.holes)) {
    const holes = screwHoles(rng, 'floor', f.patterns, width - 2 * wall, depth - 2 * wall, floor, 0.2, 5);
    if (holes?.kind === 'holes' && holes.place.pattern === 'corners') holes.place.inset += Math.ceil(cornerSize);
    if (holes) features.push(holes);
  }
  if (rng.chance(f.tabs)) {
    const hole = rng.pick([3, 3.5, 4, 4.5, 5]);
    const tabWidth = fit(rng, hole + 5, Math.min(24, depth - 2 * cornerSize - 4));
    if (tabWidth !== undefined) {
      const length = rng.size(Math.ceil(tabWidth / 2 + hole / 2 + 2.5), Math.ceil(tabWidth / 2 + hole / 2 + 10));
      features.push({ kind: 'tabs', length, width: tabWidth, thickness: rng.size(2, Math.min(5, height), 0.5), hole });
    }
  }
  return { family: f.id, body: { kind: 'box', width, depth, height, wall, floor, corner, cornerSize }, features };
}
