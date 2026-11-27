import type { Rng } from '../rng.ts';
import type { Feature, Tree } from '../tree.ts';
import { fit, screwHoles } from './pick.ts';

export const bracket = {
  id: 'bracket',
  width: [15, 80],
  base: [20, 80],
  height: [20, 100],
  thickness: [2.5, 6],
  baseHoles: 0.8,
  baseSlots: 0.2,
  uprightHoles: 0.8,
  patterns: ['center', 'pair', 'pair', 'row'] as const,
  countersink: 0.4,
  gussets: 0.4,
} as const;

export function sampleBracket(rng: Rng): Tree {
  const f = bracket;
  const width = rng.size(f.width[0], f.width[1]);
  const base = rng.size(f.base[0], f.base[1]);
  const height = rng.size(f.height[0], f.height[1]);
  const thickness = rng.size(f.thickness[0], f.thickness[1], 0.5);
  const features: Feature[] = [];
  let centred = false;
  if (rng.chance(f.baseSlots)) {
    const slotWidth = rng.pick([3, 3.5, 4, 4.5, 5]);
    const length = fit(rng, slotWidth + 5, (base - thickness) * 0.6);
    const two = width >= 40 && rng.chance(0.5);
    const spacing = two ? fit(rng, slotWidth + 6, width - slotWidth - 8) : 0;
    if (length !== undefined && spacing !== undefined) {
      features.push({ kind: 'slots', face: 'base', count: two ? 2 : 1, length, width: slotWidth, spacing, along: 'v' });
      centred = !two;
    }
  } else if (rng.chance(f.baseHoles)) {
    const holes = screwHoles(rng, 'base', f.patterns, width, base - thickness, thickness, f.countersink);
    if (holes) features.push(holes);
    centred = holes?.kind === 'holes' && holes.place.pattern !== 'pair';
  }
  if (rng.chance(f.uprightHoles)) {
    const holes = screwHoles(rng, 'upright', f.patterns, width, height - thickness, thickness, f.countersink, 5);
    if (holes) features.push(holes);
    centred ||= holes?.kind === 'holes' && holes.place.pattern !== 'pair';
  }
  // a bracket is screwed on: when no holes or slots fit, one small hole goes in the middle of a leg
  if (!features.length) {
    const hole =
      screwHoles(rng, 'upright', ['center'], width, height - thickness, thickness, 0, 4) ??
      screwHoles(rng, 'base', ['center'], width, base - thickness, thickness, 0, 4);
    if (hole) features.push(hole);
    centred = hole !== undefined;
  }
  if (rng.chance(f.gussets)) {
    const most = Math.min(base, height) - thickness - 2;
    // the gussets stay below the screw holes, so a screw head never sits against one
    let below = most;
    for (const h of features) if (h.kind === 'holes') below = Math.min(below, ((h.face === 'base' ? base : height) - thickness) / 2 - h.d - 1.5);
    const size = fit(rng, Math.max(6, Math.min(most * 0.4, below)), Math.min(most * 0.8, below));
    if (size !== undefined) features.push({ kind: 'gussets', count: centred ? 2 : rng.int(1, 2), size, thickness: rng.size(2, thickness, 0.5) });
  }
  return { family: f.id, body: { kind: 'angle', width, base, height, thickness }, features };
}
