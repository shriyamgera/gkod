import { ZERO_VOLUME_MM3 } from '#checks/limits';
import { type Mesh, root } from '#checks/mesh';
import type { Vec3 } from '#checks/types';

/** What is wrong with the separate pieces of a closed surface, if anything. */
export type PieceProblem = 'inside-out' | 'inside-another' | null;

type Piece = { faces: number[]; volume: number; min: Vec3; max: Vec3; probe: Vec3 };

/**
 * Splits a closed surface into its separate pieces and checks each one faces the right way.
 * A piece on its own must face outwards. A piece inside another one must face inwards, as the wall of a hollow does;
 * one that faces outwards there is a second solid overlapping the first.
 */
export function pieceProblem(mesh: Mesh): PieceProblem {
  const pieces = findPieces(mesh).filter((piece) => Math.abs(piece.volume) > ZERO_VOLUME_MM3);
  if (pieces.length < 2) return null;
  for (const piece of pieces) {
    let around = 0;
    for (const other of pieces) {
      if (other !== piece && encloses(mesh, other, piece.probe)) around++;
    }
    if (around % 2 === 0 && piece.volume < 0) return 'inside-out';
    if (around % 2 === 1 && piece.volume > 0) return 'inside-another';
  }
  return null;
}

function findPieces(mesh: Mesh): Piece[] {
  const parent = new Int32Array(mesh.triangles);
  for (let t = 0; t < mesh.triangles; t++) parent[t] = t;
  const { faces, first, second } = mesh.edges;
  for (let e = 0; e < faces.length; e++) {
    if (second[e]! >= 0) parent[root(parent, first[e]!)] = root(parent, second[e]!);
  }
  let roots = 0;
  for (let t = 0; t < mesh.triangles && roots < 2; t++) if (!mesh.skipped[t] && root(parent, t) === t) roots++;
  if (roots < 2) return [];
  const byRoot = new Map<number, Piece>();
  const p = mesh.positions;
  const [ox, oy, oz] = mesh.min;
  for (let t = 0; t < mesh.triangles; t++) {
    if (mesh.skipped[t]) continue;
    const key = root(parent, t);
    let piece = byRoot.get(key);
    if (!piece) {
      piece = { faces: [], volume: 0, min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity], probe: [0, 0, 0] };
      byRoot.set(key, piece);
    }
    piece.faces.push(t);
    const o = t * 9;
    const ax = p[o]! - ox, ay = p[o + 1]! - oy, az = p[o + 2]! - oz;
    const bx = p[o + 3]! - ox, by = p[o + 4]! - oy, bz = p[o + 5]! - oz;
    const cx = p[o + 6]! - ox, cy = p[o + 7]! - oy, cz = p[o + 8]! - oz;
    piece.volume += (ax * (by * cz - bz * cy) - ay * (bx * cz - bz * cx) + az * (bx * cy - by * cx)) / 6;
    for (let i = o; i < o + 9; i++) {
      piece.min[i % 3] = Math.min(piece.min[i % 3]!, p[i]!);
      piece.max[i % 3] = Math.max(piece.max[i % 3]!, p[i]!);
    }
  }
  const pieces = [...byRoot.values()];
  // the middle of each piece's largest face is the point tested against the other pieces
  for (const piece of pieces) {
    const t = piece.faces.reduce((a, b) => (mesh.areas[b]! > mesh.areas[a]! ? b : a));
    const o = t * 9;
    piece.probe = [0, 1, 2].map((k) => (p[o + k]! + p[o + 3 + k]! + p[o + 6 + k]!) / 3) as Vec3;
  }
  return pieces;
}

// True when the point is inside the piece: a ray from it along +X crosses the piece's surface an odd number of times.
// The ray is moved off the point by a hair, so it does not run exactly along an edge.
function encloses(mesh: Mesh, piece: Piece, [px, py, pz]: Vec3): boolean {
  if (px > piece.max[0] || py < piece.min[1] || py > piece.max[1] || pz < piece.min[2] || pz > piece.max[2]) return false;
  const y = py + 1.31e-7, z = pz + 2.17e-7;
  const p = mesh.positions;
  let crossings = 0;
  for (const t of piece.faces) {
    const o = t * 9;
    const ay = p[o + 1]! - y, az = p[o + 2]! - z;
    const by = p[o + 4]! - y, bz = p[o + 5]! - z;
    const cy = p[o + 7]! - y, cz = p[o + 8]! - z;
    const u = by * cz - bz * cy, v = cy * az - cz * ay, w = ay * bz - az * by;
    if (!((u > 0 && v > 0 && w > 0) || (u < 0 && v < 0 && w < 0))) continue;
    const x = (u * p[o]! + v * p[o + 3]! + w * p[o + 6]!) / (u + v + w);
    if (x > px) crossings++;
  }
  return crossings % 2 === 1;
}
