import type { Rng } from '../rng.ts';
import type { Feature, Tree } from '../tree.ts';
import { fit, screwHoles } from './pick.ts';

export const channel = {
  id: 'channel',
  width: [15, 60],
  length: [40, 160],
  height: [8, 40],
  wall: [1.6, 3],
  floor: [1.6, 3],
  holes: 0.6,
  patterns: ['row', 'row', 'pair', 'center'] as const,
  countersink: 0.3,
  slots: 0.25,
  lips: 0.4,
} as const;

export function sampleChannel(rng: Rng): Tree {
  const f = channel;
  const width = rng.size(f.width[0], f.width[1]);
  const length = rng.size(f.length[0], f.length[1]);
  const height = rng.size(f.height[0], f.height[1]);
  const wall = rng.size(f.wall[0], f.wall[1], 0.2);
  const floor = rng.size(f.floor[0], f.floor[1], 0.2);
  const inner = width - 2 * wall;
  const features: Feature[] = [];
  if (rng.chance(f.holes)) {
    const holes = screwHoles(rng, 'floor', f.patterns, length, inner, floor, f.countersink, 5);
    if (holes) features.push(holes);
  } else if (rng.chance(f.slots)) {
    // slots across the floor, for cable ties
    const slotWidth = rng.pick([3, 4, 5]);
    const two = rng.chance(0.6);
    const slotLength = fit(rng, slotWidth + 3, inner - 4);
    const spacing = two ? fit(rng, slotWidth + 6, length * 0.7) : 0;
    if (slotLength !== undefined && spacing !== undefined) {
      features.push({ kind: 'slots', face: 'floor', count: two ? 2 : 1, length: slotLength, width: slotWidth, spacing, along: 'v' });
    }
  }
  if (rng.chance(f.lips)) {
    const lip = fit(rng, 1, Math.min(4, (inner - 6) / 2, (height - floor - 4) / 1.5), 0.5);
    if (lip !== undefined) features.push({ kind: 'lips', width: lip });
  }
  return { family: f.id, body: { kind: 'channel', width, length, height, wall, floor }, features };
}
