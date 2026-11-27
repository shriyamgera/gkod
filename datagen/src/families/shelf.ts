import type { Rng } from '../rng.ts';
import type { Feature, Tree } from '../tree.ts';
import { fit, holeRoom } from './pick.ts';

export const shelf = {
  id: 'shelf',
  width: [60, 180],
  // the shelf, out from the wall
  depth: [40, 100],
  back: [30, 70],
  thickness: [3, 5],
  holes: [3.5, 4, 4.5, 5],
  countersink: 0.6,
  row: 0.3,
  gussets: 0.85,
} as const;

/**
 * Screw holes across the back of a shelf or tool holder, clear of a gusset at each end. The gussets stand against the
 * back, so a screw head beside one needs its own width of room.
 */
export function backHoles(rng: Rng, width: number, back: number, thickness: number, gusset: number, holes: readonly number[], sink: number, row: number): Feature | undefined {
  const d = rng.pick(holes);
  const countersink = thickness >= d / 2 + 1.5 && rng.chance(sink);
  const room = holeRoom(d, countersink);
  if (back - thickness < 2 * room + 1) return undefined;
  // from the end of the part to the nearest hole's centre
  const clear = gusset ? gusset + d + 1.5 : room + 1;
  if (width >= 120 && rng.chance(row)) {
    const inset = fit(rng, clear, clear + 15, 0.5);
    if (inset !== undefined) return { kind: 'holes', face: 'upright', d, countersink, place: { pattern: 'row', count: 3, inset } };
  }
  const spacing = fit(rng, Math.max(2 * room + 2, width * 0.3), width - 2 * clear);
  return spacing === undefined ? undefined : { kind: 'holes', face: 'upright', d, countersink, place: { pattern: 'pair', spacing } };
}

export function sampleShelf(rng: Rng): Tree {
  const f = shelf;
  const width = rng.size(f.width[0], f.width[1]);
  const base = rng.size(f.depth[0], f.depth[1]);
  const height = rng.size(f.back[0], f.back[1]);
  const thickness = rng.size(f.thickness[0], f.thickness[1], 0.5);
  const features: Feature[] = [];
  const gussets = rng.chance(f.gussets);
  const gt = gussets ? rng.size(2.5, thickness, 0.5) : 0;
  // a shelf is screwed to the wall through its back
  const holes = backHoles(rng, width, height, thickness, gt, f.holes, f.countersink, f.row);
  if (holes) features.push(holes);
  if (gussets) {
    const most = Math.min(base, height) - thickness - 2;
    const size = fit(rng, most * 0.5, most * 0.85);
    if (size !== undefined) features.push({ kind: 'gussets', count: 2, size, thickness: gt });
  }
  return { family: f.id, body: { kind: 'angle', width, base, height, thickness }, features };
}
