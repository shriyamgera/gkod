import type { Rng } from '../rng.ts';
import type { Corner, Feature, Tree } from '../tree.ts';
import { fit, holeRoom, screwHoles } from './pick.ts';

export const plate = {
  id: 'plate',
  width: [30, 160],
  depth: [20, 120],
  thickness: [2, 8],
  corners: ['sharp', 'round', 'round', 'chamfer'] as Corner[],
  holes: 0.85,
  patterns: ['corners', 'corners', 'pair', 'row', 'center', 'grid'] as const,
  countersink: 0.35,
  standoffs: 0.12,
  slot: 0.15,
  pocket: 0.15,
  ribs: 0.2,
  lip: 0.12,
  notch: 0.12,
} as const;

// Moves corner holes in far enough to clear a rounded or chamfered corner.
function clearCorner(holes: Feature, corner: Corner, size: number) {
  if (holes.kind !== 'holes' || holes.place.pattern !== 'corners' || corner === 'sharp') return;
  const room = holeRoom(holes.d, holes.countersink);
  const need = corner === 'round' ? size - (size - room) / Math.SQRT2 : (size + Math.SQRT2 * room) / 2;
  if (holes.place.inset < need + 0.5) holes.place.inset = Math.ceil((need + 0.5) * 2) / 2;
}

export function samplePlate(rng: Rng): Tree {
  const f = plate;
  const width = rng.size(f.width[0], f.width[1]);
  const depth = rng.size(f.depth[0], Math.min(f.depth[1], width));
  const thickness = rng.size(f.thickness[0], f.thickness[1], 0.5);
  const corner = rng.pick(f.corners);
  const cornerSize = corner === 'sharp' ? 0 : rng.size(2, Math.max(2, Math.min(10, Math.floor(Math.min(width, depth) / 5))), 0.5);
  const features: Feature[] = [];
  let middle = false;
  if (rng.chance(f.standoffs)) {
    const d = rng.size(6, 10, 0.5);
    const hole = rng.pick([2.5, 3, 3.5].filter((h) => h <= d - 3.2));
    const x = fit(rng, Math.max(d + 4, width * 0.4), width - d - 2 * cornerSize - 2);
    const y = fit(rng, Math.max(d + 4, depth * 0.4), depth - d - 2 * cornerSize - 2);
    if (x !== undefined && y !== undefined) {
      features.push({ kind: 'bosses', d, height: rng.size(3, 10, 0.5), hole, place: { pattern: 'grid', x, y } });
    }
  } else if (rng.chance(f.holes)) {
    const holes = screwHoles(rng, 'top', f.patterns, width, depth, thickness, f.countersink);
    if (holes) {
      clearCorner(holes, corner, cornerSize);
      features.push(holes);
      middle = holes.kind === 'holes' && ['center', 'row', 'pair'].includes(holes.place.pattern);
    }
  }
  if (!middle && rng.chance(f.slot)) {
    const slotWidth = rng.pick([3, 3.5, 4, 4.5, 5, 6]);
    const along = rng.pick(['u', 'v'] as const);
    const length = fit(rng, slotWidth + 5, (along === 'u' ? width : depth) * 0.45);
    if (length !== undefined) features.push({ kind: 'slots', face: 'top', count: 1, length, width: slotWidth, spacing: 0, along });
    middle = true;
  }
  if (!middle && thickness >= 3 && rng.chance(f.pocket)) {
    features.push({
      kind: 'pocket',
      face: 'top',
      width: rng.size(Math.round(width * 0.2), Math.round(width * 0.45)),
      length: rng.size(Math.round(depth * 0.2), Math.round(depth * 0.45)),
      depth: rng.size(1, thickness - 1.6, 0.5),
    });
    middle = true;
  }
  if (!middle && rng.chance(f.ribs)) {
    const t = rng.size(2, 4, 0.5);
    features.push({ kind: 'ribs', count: rng.int(1, 3), thickness: t, height: rng.size(3, Math.min(15, 6 * t), 0.5) });
  }
  if (rng.chance(f.lip)) {
    // a raised edge, low enough that the plate does not turn into a tray
    features.push({ kind: 'lip', height: rng.size(2, 6, 0.5), wall: rng.size(1.6, 3, 0.2) });
  } else if (rng.chance(f.notch)) {
    const notchWidth = fit(rng, 8, width / 2 - cornerSize - 4);
    if (notchWidth !== undefined) features.push({ kind: 'notch', width: notchWidth, depth: rng.size(3, Math.max(3, Math.floor(depth / 4))) });
  }
  return { family: f.id, body: { kind: 'plate', width, depth, thickness, corner, cornerSize }, features };
}
