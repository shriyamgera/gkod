import type { Rng } from '../rng.ts';
import type { Corner, Feature, Tree } from '../tree.ts';
import { fit } from './pick.ts';

export const slotPlate = {
  id: 'slot_plate',
  width: [50, 160],
  depth: [30, 100],
  thickness: [3, 6],
  corners: ['sharp', 'round', 'round', 'chamfer'] as Corner[],
  slotWidths: [4, 4.5, 5, 5.5, 6, 6.5],
  // the slots run front to back more often than side to side
  along: ['v', 'v', 'u'] as const,
  centreHole: 0.4,
  holes: [4, 5, 6, 8],
} as const;

export function sampleSlotPlate(rng: Rng): Tree {
  const f = slotPlate;
  const width = rng.size(f.width[0], f.width[1]);
  const depth = rng.size(f.depth[0], Math.min(f.depth[1], width));
  const thickness = rng.size(f.thickness[0], f.thickness[1], 0.5);
  const corner = rng.pick(f.corners);
  const cornerSize = corner === 'sharp' ? 0 : rng.size(2, Math.max(2, Math.min(6, Math.floor(Math.min(width, depth) / 8))), 0.5);
  const features: Feature[] = [];
  // two slots, one near each end, so the plate can slide before it is tightened
  const slotWidth = rng.pick(f.slotWidths);
  // side to side only when the plate is deep enough for two slots one above the other
  const along = depth >= 50 ? rng.pick(f.along) : 'v';
  const [run, across] = along === 'v' ? [depth, width] : [width, depth];
  const length = fit(rng, slotWidth + 6, run * 0.6);
  const spacing = fit(rng, Math.max(across * 0.35, slotWidth + 10), across - slotWidth - 2 * cornerSize - 8);
  if (rng.chance(f.centreHole) && spacing !== undefined) {
    // a hole in the middle, between the slots, for a locating pin or a third screw
    const fits = f.holes.filter((hole) => hole <= spacing - slotWidth - 6);
    if (fits.length) features.push({ kind: 'holes', face: 'top', d: rng.pick(fits), countersink: false, place: { pattern: 'center' } });
  }
  if (length !== undefined && spacing !== undefined) {
    features.push({ kind: 'slots', face: 'top', count: 2, length, width: slotWidth, spacing, along });
  }
  return { family: f.id, body: { kind: 'plate', width, depth, thickness, corner, cornerSize }, features };
}
