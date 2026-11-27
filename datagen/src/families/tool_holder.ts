import type { Rng } from '../rng.ts';
import type { Feature, Tree } from '../tree.ts';
import { fit } from './pick.ts';
import { backHoles } from './shelf.ts';

export const toolHolder = {
  id: 'tool_holder',
  width: [80, 180],
  // the shelf the tools hang through, out from the wall
  depth: [30, 55],
  back: [30, 60],
  thickness: [3, 5],
  // holes for screwdriver shafts and other tools
  toolHoles: [6, 7, 8, 9, 10, 11, 12],
  toolCount: [3, 8],
  screwHoles: [3.5, 4, 4.5],
  countersink: 0.5,
  gussets: 0.6,
} as const;

export function sampleToolHolder(rng: Rng): Tree {
  const f = toolHolder;
  const width = rng.size(f.width[0], f.width[1]);
  const thickness = rng.size(f.thickness[0], f.thickness[1], 0.5);
  const d = rng.pick(f.toolHoles);
  const base = rng.size(Math.max(f.depth[0], Math.ceil(thickness + d + 8)), Math.max(f.depth[1], Math.ceil(thickness + d + 8)));
  const height = rng.size(f.back[0], f.back[1]);
  const features: Feature[] = [];
  const gussets = rng.chance(f.gussets);
  const gt = gussets ? rng.size(2.5, thickness, 0.5) : 0;
  // a row of tool holes along the shelf, clear of the gussets at the ends
  const clear = gussets ? gt + d + 1.5 : d / 2 + 2.6;
  const inset = fit(rng, clear, clear + 10, 0.5);
  if (inset !== undefined) {
    const most = Math.floor((width - 2 * inset) / (d + 4)) + 1;
    if (most >= 3) features.push({ kind: 'holes', face: 'base', d, countersink: false, place: { pattern: 'row', count: rng.int(f.toolCount[0], Math.min(f.toolCount[1], most)), inset } });
  }
  const holes = backHoles(rng, width, height, thickness, gt, f.screwHoles, f.countersink, 0);
  if (holes) features.push(holes);
  if (gussets) {
    const most = Math.min(base, height) - thickness - 2;
    const size = fit(rng, most * 0.4, most * 0.8);
    if (size !== undefined) features.push({ kind: 'gussets', count: 2, size, thickness: gt });
  }
  return { family: f.id, body: { kind: 'angle', width, base, height, thickness }, features };
}
