import type { Rng } from '../rng.ts';
import type { Feature, Tree } from '../tree.ts';

export const bitHolder = {
  id: 'bit_holder',
  // across the flats, a little over a 6.35 mm hex bit
  sizes: [6.6, 6.7, 6.8, 7, 7.2],
  depth: [6, 12],
  columns: [3, 10],
  // two rows or more, so the row count can move both ways on a block sized to its sockets
  rows: [2, 4],
  margin: [4, 8],
  floor: [2, 4],
  round: 0.5,
} as const;

/** Round cells: the socket diameter and depth for each kind. */
export const CELLS = {
  AAA: { d: [11, 11.5], depth: [10, 20] },
  AA: { d: [15, 15.5], depth: [12, 25] },
  '18650': { d: [19, 19.5], depth: [15, 30] },
  C: { d: [27, 27.5], depth: [15, 25] },
} as const;

export const batteryHolder = {
  id: 'battery_holder',
  cells: ['AAA', 'AA', 'AA', '18650', 'C'] as const,
  columns: [2, 8],
  rows: [2, 4],
  wall: [2.5, 4],
  margin: [3, 6],
  floor: [2, 4],
  round: 0.5,
} as const;

/** A plate just big enough for a grid of sockets, with a margin all round. */
function block(rng: Rng, family: string, f: Extract<Feature, { kind: 'sockets' }>, margin: number, floor: number, round: number): Tree {
  const r = f.hex ? f.d / 2 / Math.cos(Math.PI / 6) : f.d / 2;
  const width = Math.ceil((f.columns - 1) * f.pitch + 2 * r + 2 * margin);
  const depth = Math.ceil((f.rows - 1) * f.pitch + 2 * r + 2 * margin);
  const corner = rng.chance(round) ? 'round' : 'sharp';
  // a rounded corner no bigger than the margin, so it never reaches a socket
  const cornerSize = corner === 'round' ? rng.size(2, Math.max(2, Math.floor(margin)), 0.5) : 0;
  return { family, body: { kind: 'plate', width, depth, thickness: f.depth + floor, corner, cornerSize }, features: [f] };
}

export function sampleBitHolder(rng: Rng): Tree {
  const f = bitHolder;
  const d = rng.pick(f.sizes);
  const r = d / 2 / Math.cos(Math.PI / 6);
  const pitch = rng.size(Math.ceil((2 * r + 2) * 2) / 2, Math.ceil((2 * r + 5) * 2) / 2, 0.5);
  const columns = rng.int(f.columns[0], f.columns[1]);
  const rows = rng.int(f.rows[0], f.rows[1]);
  const sockets: Extract<Feature, { kind: 'sockets' }> = { kind: 'sockets', columns, rows, d, depth: rng.size(f.depth[0], f.depth[1], 0.5), pitch, hex: true };
  return block(rng, f.id, sockets, rng.size(f.margin[0], f.margin[1], 0.5), rng.size(f.floor[0], f.floor[1], 0.5), f.round);
}

export function sampleBatteryHolder(rng: Rng): Tree {
  const f = batteryHolder;
  const cell = CELLS[rng.pick(f.cells)];
  const d = rng.size(cell.d[0], cell.d[1], 0.5);
  const pitch = d + rng.size(f.wall[0], f.wall[1], 0.5);
  const margin = rng.size(f.margin[0], f.margin[1], 0.5);
  // as many columns as fit in a 200 mm block
  const columns = rng.int(f.columns[0], Math.min(f.columns[1], Math.floor((195 - d - 2 * margin) / pitch) + 1));
  const rows = rng.int(f.rows[0], Math.min(f.rows[1], Math.floor((195 - d - 2 * margin) / pitch) + 1));
  const sockets: Extract<Feature, { kind: 'sockets' }> = { kind: 'sockets', columns, rows, d, depth: rng.size(cell.depth[0], cell.depth[1]), pitch, hex: false };
  return block(rng, f.id, sockets, margin, rng.size(f.floor[0], f.floor[1], 0.5), f.round);
}
