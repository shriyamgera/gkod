import { WELD_MM, ZERO_AREA_MM2 } from '#checks/limits';
import type { Vec3 } from '#checks/types';

/** Edges of the welded mesh, one entry per edge. */
export type Edges = {
  /** How many triangles use the edge. */
  faces: Int32Array;
  /** +1 for each triangle that runs along it one way, -1 for the other way: 0 when two neighbours agree. */
  turn: Int32Array;
  /** The first two triangles on the edge, or -1. */
  first: Int32Array;
  second: Int32Array;
  /** The edge of each triangle side, three per triangle (side 0 is corner 0 to 1); -1 for skipped triangles. */
  ofSide: Int32Array;
};

export type Mesh = {
  triangles: number;
  positions: Float32Array;
  /** Welded corner id, three per triangle: corners at the same spot share an id. */
  corners: Int32Array;
  /** Unit normal, three per triangle; zero when the triangle has no area. */
  normals: Float64Array;
  areas: Float64Array;
  /** 1 when two corners of a triangle weld into one, so it has no edges of its own. */
  skipped: Uint8Array;
  min: Vec3;
  max: Vec3;
  edges: Edges;
};

export function buildMesh(positions: Float32Array): Mesh {
  const triangles = positions.length / 9;
  const corners = weld(positions, triangles * 3);
  const normals = new Float64Array(triangles * 3);
  const areas = new Float64Array(triangles);
  const skipped = new Uint8Array(triangles);
  for (let t = 0; t < triangles; t++) {
    const a = corners[t * 3]!;
    const b = corners[t * 3 + 1]!;
    const c = corners[t * 3 + 2]!;
    if (a === b || b === c || c === a) skipped[t] = 1;
    areas[t] = faceNormal(positions, t, normals);
  }
  const [min, max] = bounds(positions);
  return { triangles, positions, corners, normals, areas, skipped, min, max, edges: findEdges(corners, skipped) };
}

/** The triangle on the other side of an edge, or -1 when there is none. */
export function across(edges: Edges, edge: number, triangle: number): number {
  const first = edges.first[edge]!;
  return first === triangle ? edges.second[edge]! : first;
}

/** The root of t in a forest of joined triangles, shortening the path on the way. */
export function root(parent: Int32Array, t: number): number {
  while (parent[t] !== t) {
    const up = parent[parent[t]!]!;
    parent[t] = up;
    t = up;
  }
  return t;
}

/** Enclosed volume in mm³: positive when the faces point outwards. */
export function signedVolume(mesh: Mesh): number {
  const p = mesh.positions;
  const [ox, oy, oz] = mesh.min;
  let sum = 0;
  for (let t = 0; t < mesh.triangles; t++) {
    const o = t * 9;
    const ax = p[o]! - ox, ay = p[o + 1]! - oy, az = p[o + 2]! - oz;
    const bx = p[o + 3]! - ox, by = p[o + 4]! - oy, bz = p[o + 5]! - oz;
    const cx = p[o + 6]! - ox, cy = p[o + 7]! - oy, cz = p[o + 8]! - oz;
    sum += ax * (by * cz - bz * cy) - ay * (bx * cz - bz * cx) + az * (bx * cy - by * cx);
  }
  return sum / 6;
}

// Gives corners closer than WELD_MM the same id. Corners are sorted into a grid of that size; a corner joins one
// in its own cell, or else one closer than WELD_MM in a neighbouring cell, just across a grid line.
function weld(positions: Float32Array, count: number): Int32Array {
  const mask = tableSize(count) - 1;
  const table = new Int32Array(mask + 1).fill(-1);
  const cellKeys = new Float64Array(count * 3);
  const cellIds = new Int32Array(count);
  const firstCorner = new Int32Array(count);
  const ids = new Int32Array(count);
  let cells = 0;
  let next = 0;
  const slotOf = (x: number, y: number, z: number) => {
    let slot = mix(Math.imul(x | 0, 73856093) ^ Math.imul(y | 0, 19349663) ^ Math.imul(z | 0, 83492791)) & mask;
    for (;;) {
      const cell = table[slot]!;
      if (cell === -1 || (cellKeys[cell * 3] === x && cellKeys[cell * 3 + 1] === y && cellKeys[cell * 3 + 2] === z)) return slot;
      slot = (slot + 1) & mask;
    }
  };
  const near = (c: number, d: number) => {
    const dx = positions[c * 3]! - positions[d * 3]!;
    const dy = positions[c * 3 + 1]! - positions[d * 3 + 1]!;
    const dz = positions[c * 3 + 2]! - positions[d * 3 + 2]!;
    return dx * dx + dy * dy + dz * dz <= WELD_MM * WELD_MM;
  };
  for (let c = 0; c < count; c++) {
    const x = Math.round(positions[c * 3]! / WELD_MM);
    const y = Math.round(positions[c * 3 + 1]! / WELD_MM);
    const z = Math.round(positions[c * 3 + 2]! / WELD_MM);
    const slot = slotOf(x, y, z);
    if (table[slot] !== -1) {
      ids[c] = cellIds[table[slot]!]!;
      continue;
    }
    let id = -1;
    for (let k = 0; k < 27 && id === -1; k++) {
      if (k === 13) continue;
      const cell = table[slotOf(x + (k % 3) - 1, y + (((k / 3) | 0) % 3) - 1, z + ((k / 9) | 0) - 1)]!;
      if (cell !== -1 && near(c, firstCorner[cellIds[cell]!]!)) id = cellIds[cell]!;
    }
    if (id === -1) {
      id = next++;
      firstCorner[id] = c;
    }
    table[slot] = cells;
    cellKeys[cells * 3] = x;
    cellKeys[cells * 3 + 1] = y;
    cellKeys[cells * 3 + 2] = z;
    cellIds[cells++] = id;
    ids[c] = id;
  }
  return ids;
}

function findEdges(corners: Int32Array, skipped: Uint8Array): Edges {
  const sides = corners.length;
  const mask = tableSize(sides) - 1;
  const table = new Int32Array(mask + 1).fill(-1);
  const low = new Int32Array(sides);
  const high = new Int32Array(sides);
  const faces = new Int32Array(sides);
  const turn = new Int32Array(sides);
  const first = new Int32Array(sides).fill(-1);
  const second = new Int32Array(sides).fill(-1);
  const ofSide = new Int32Array(sides).fill(-1);
  let count = 0;
  for (let s = 0; s < sides; s++) {
    const t = (s / 3) | 0;
    if (skipped[t]) continue;
    const u = corners[s]!;
    const v = corners[s % 3 === 2 ? s - 2 : s + 1]!;
    const a = u < v ? u : v;
    const b = u < v ? v : u;
    let slot = mix(Math.imul(a, 0x9e3779b1) ^ b) & mask;
    let e = table[slot]!;
    while (e !== -1 && (low[e] !== a || high[e] !== b)) {
      slot = (slot + 1) & mask;
      e = table[slot]!;
    }
    if (e === -1) {
      e = count++;
      table[slot] = e;
      low[e] = a;
      high[e] = b;
    }
    const used = faces[e]!;
    if (used === 0) first[e] = t;
    else if (used === 1) second[e] = t;
    faces[e] = used + 1;
    turn[e] = turn[e]! + (u < v ? 1 : -1);
    ofSide[s] = e;
  }
  return {
    faces: faces.subarray(0, count),
    turn: turn.subarray(0, count),
    first: first.subarray(0, count),
    second: second.subarray(0, count),
    ofSide,
  };
}

function faceNormal(p: Float32Array, t: number, out: Float64Array): number {
  const o = t * 9;
  const ux = p[o + 3]! - p[o]!, uy = p[o + 4]! - p[o + 1]!, uz = p[o + 5]! - p[o + 2]!;
  const vx = p[o + 6]! - p[o]!, vy = p[o + 7]! - p[o + 1]!, vz = p[o + 8]! - p[o + 2]!;
  const x = uy * vz - uz * vy;
  const y = uz * vx - ux * vz;
  const z = ux * vy - uy * vx;
  const length = Math.hypot(x, y, z);
  const area = length / 2;
  if (area <= ZERO_AREA_MM2) return 0;
  out[t * 3] = x / length;
  out[t * 3 + 1] = y / length;
  out[t * 3 + 2] = z / length;
  return area;
}

function bounds(p: Float32Array): [Vec3, Vec3] {
  if (p.length === 0) return [[0, 0, 0], [0, 0, 0]];
  const min: Vec3 = [Infinity, Infinity, Infinity];
  const max: Vec3 = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < p.length; i += 3) {
    for (let k = 0; k < 3; k++) {
      const value = p[i + k]!;
      if (value < min[k]!) min[k] = value;
      if (value > max[k]!) max[k] = value;
    }
  }
  return [min, max];
}

function tableSize(items: number): number {
  let size = 16;
  while (size < items * 2) size *= 2;
  return size;
}

// Spreads the bits of a hash so that nearby grid points land far apart in the table.
function mix(h: number): number {
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  return (h ^ (h >>> 16)) >>> 0;
}
