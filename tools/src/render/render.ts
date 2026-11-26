import { bedArea, GRID_MM } from '../../../app/src/viewer/grid.ts';
import { drawText, GLYPH_HEIGHT } from './font.ts';
import { encodePng } from './png.ts';
import { Raster, type Rgb } from './raster.ts';
import { type Basis, basisFor, cross, dot, frameFor, toPixel, type Vec3, type View } from './view.ts';

// The site's paper and ink palette (app/src/styles/tokens.css and the viewer's colours).
const PAPER = hex('#edebe5');
const BED = hex('#f7f6f2');
const GRID = hex('#d3cfc6');
const GRID_EDGE = hex('#bdb8ad');
const INK = hex('#121212');
const MUTED = hex('#5c5952');
const MARK = hex('#f04a00');
// The viewer's paper tones, from a face turned away from the light to one facing it.
const TONES: [number, Rgb][] = [
  [0, hex('#9e998d')],
  [0.35, hex('#bfbaaf')],
  [0.6, hex('#ddd9d0')],
  [0.95, hex('#ffffff')],
];
// Edges where the surface bends more than this get an ink line, as in the viewer.
const EDGE_ANGLE_DEG = 28;
// A see-through copy of the marked faces, so a mark underneath still shows from above, as in the viewer.
const MARK_THROUGH = 0.3;

export type RenderOptions = { size?: number; view?: View; marked?: readonly number[] };
export type Picture = { png: Buffer; width: number; height: number; size: Vec3; triangles: number };

function hex(code: string): Rgb {
  const n = Number.parseInt(code.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function mix(a: Rgb, b: Rgb, t: number): Rgb {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

function tone(t: number): Rgb {
  let lower = TONES[0]!;
  for (const upper of TONES) {
    if (t <= upper[0]) return mix(lower[1], upper[1], upper[0] > lower[0] ? (t - lower[0]) / (upper[0] - lower[0]) : 0);
    lower = upper;
  }
  return lower[1];
}

// Two lights fixed to the camera, so every view reads the same way: a main one from the upper left and a weak
// one from the right. A vector's length is its light's strength. In the iso view a box's top comes out near white,
// its front a light grey and its right side darker; a face turned straight at the camera gets a middle grey, so a
// part seen from the top still stands out from the bed.
function lighting(basis: Basis): (normal: Vec3) => number {
  const at = (r: number, u: number, b: number): Vec3 =>
    [0, 1, 2].map((k) => r * basis.right[k]! + u * basis.up[k]! + b * basis.back[k]!) as Vec3;
  const key = at(-0.87, 0.62, 0.28);
  const fill = at(0.2, 0.02, 0.07);
  return (n) => Math.min(1, 0.15 + Math.max(0, dot(n, key)) + Math.max(0, dot(n, fill)));
}

function bounds(positions: Float32Array): { min: Vec3; max: Vec3 } {
  const min: Vec3 = [Infinity, Infinity, Infinity];
  const max: Vec3 = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < positions.length; i += 3) {
    for (let k = 0; k < 3; k++) {
      min[k] = Math.min(min[k]!, positions[i + k]!);
      max[k] = Math.max(max[k]!, positions[i + k]!);
    }
  }
  return { min, max };
}

function corner(positions: Float32Array, t: number, c: number): Vec3 {
  const o = t * 9 + c * 3;
  return [positions[o]!, positions[o + 1]!, positions[o + 2]!];
}

function faceNormal(positions: Float32Array, t: number): Vec3 | null {
  const a = corner(positions, t, 0), b = corner(positions, t, 1), c = corner(positions, t, 2);
  const n = cross([b[0] - a[0], b[1] - a[1], b[2] - a[2]], [c[0] - a[0], c[1] - a[1], c[2] - a[2]]);
  const length = Math.hypot(n[0], n[1], n[2]);
  return length > 1e-12 ? [n[0] / length, n[1] / length, n[2] / length] : null;
}

// Each edge of the joined-up mesh with the triangles on it: corners closer than 0.0001 mm are the same corner.
function edgesOf(positions: Float32Array, triangles: number): Map<number, number[]> {
  const ids = new Map<string, number>();
  const corners = new Int32Array(triangles * 3);
  for (let i = 0; i < triangles * 3; i++) {
    const key = `${Math.round(positions[i * 3]! * 1e4)},${Math.round(positions[i * 3 + 1]! * 1e4)},${Math.round(positions[i * 3 + 2]! * 1e4)}`;
    let id = ids.get(key);
    if (id === undefined) ids.set(key, (id = ids.size));
    corners[i] = id;
  }
  const edges = new Map<number, number[]>();
  for (let t = 0; t < triangles; t++) {
    for (let s = 0; s < 3; s++) {
      const a = corners[t * 3 + s]!, b = corners[t * 3 + ((s + 1) % 3)]!;
      if (a === b) continue;
      const key = Math.min(a, b) * 2 ** 26 + Math.max(a, b);
      const list = edges.get(key);
      if (list) list.push(t, s);
      else edges.set(key, [t, s]);
    }
  }
  return edges;
}

const mm = (value: number) => String(Math.round(value * 10) / 10);

/** Draws the part on its patch of print bed as a PNG. `marked` faces are drawn in the accent colour. */
export function renderMesh(positions: Float32Array, opts: RenderOptions = {}): Picture {
  const size = opts.size ?? 900;
  const view = opts.view ?? 'iso';
  const triangles = positions.length / 9;
  if (triangles < 1) throw new Error('The part has no triangles to draw.');
  const part = bounds(positions);
  const partSize: Vec3 = [part.max[0] - part.min[0], part.max[1] - part.min[1], part.max[2] - part.min[2]];

  // drawn three times as large and shrunk at the end, which smooths the edges
  const ss = size <= 1200 ? 3 : 2;
  const width = size * ss;
  const labelScale = Math.max(1, Math.round(size / 300));
  const margin = Math.round(size * 0.05) * ss;
  const bottom = (GLYPH_HEIGHT + 6) * labelScale * ss;
  // framed on the part's box and the bed patch under it, so nothing is cut off
  const bed = bedArea(part);
  const z = bed.min[2];
  const seen: Vec3[] = [];
  for (const x of [0, 1]) {
    for (const y of [0, 1]) {
      seen.push([x ? bed.max[0] : bed.min[0], y ? bed.max[1] : bed.min[1], z]);
      for (const k of [0, 1]) seen.push([x ? part.max[0] : part.min[0], y ? part.max[1] : part.min[1], k ? part.max[2] : part.min[2]]);
    }
  }
  const basis = basisFor(view);
  const square = frameFor(seen, basis, width, width, margin, bottom);
  // a wide part gets a shorter picture rather than empty paper above and below it
  const rows = Math.ceil(Math.max(square.span[1] * square.scale + 2 * margin + bottom, width * 0.6) / ss);
  const height = Math.min(size, rows) * ss;
  const frame = height < width ? frameFor(seen, basis, width, height, margin, bottom) : square;
  const px = (p: Vec3) => toPixel(p, basis, frame);
  const raster = new Raster(width, height, PAPER);

  // depth slack, in mm, worth about this many pixels of the big picture
  const pixels = (n: number) => n / frame.scale;
  // ink lines about one pixel wide in the finished picture, a little more in a big one
  const line = ss * Math.max(1, (1.15 * size) / 900);

  // the bed, a little behind its true depth so the part's lowest faces win
  const flat = Math.abs(basis.back[2]) > 0.05;
  const bedPush = pixels(2);
  if (flat) {
    const corners = [
      [bed.min[0], bed.min[1]],
      [bed.max[0], bed.min[1]],
      [bed.max[0], bed.max[1]],
      [bed.min[0], bed.max[1]],
    ].map(([x, y]) => {
      const p = px([x!, y!, z]);
      return [p[0], p[1], p[2] - bedPush] as Vec3;
    });
    raster.triangle(corners[0]!, corners[1]!, corners[2]!, BED, -1);
    raster.triangle(corners[0]!, corners[2]!, corners[3]!, BED, -1);
  }

  const marked = new Set(opts.marked ?? []);
  const shade = lighting(basis);
  const normals: (Vec3 | null)[] = [];
  for (let t = 0; t < triangles; t++) {
    const n = faceNormal(positions, t);
    normals.push(n);
    if (!n) continue;
    // a face seen from behind (an open or inside-out part) is shaded as if it faced the camera
    const facing: Vec3 = dot(n, basis.back) < 0 ? [-n[0], -n[1], -n[2]] : n;
    const light = shade(facing);
    const color = marked.has(t) ? mix(mix(MARK, INK, 0.45), MARK, Math.min(1, light * 1.25)) : tone(light);
    raster.triangle(px(corner(positions, t, 0)), px(corner(positions, t, 1)), px(corner(positions, t, 2)), color, t);
  }

  if (marked.size > 0) {
    const mask = new Uint8Array(width * height);
    for (const t of marked) {
      if (t < 0 || t >= triangles) continue;
      raster.triangle(px(corner(positions, t, 0)), px(corner(positions, t, 1)), px(corner(positions, t, 2)), MARK, t, mask);
    }
    for (let i = 0; i < mask.length; i++) if (mask[i] && !marked.has(raster.face[i]!)) raster.blend(i, MARK, MARK_THROUGH);
  }

  // the bed grid, one line every 10 mm, hidden where the part is in front of it
  const gridLine = (a: Vec3, b: Vec3, color: Rgb) => raster.line(px(a), px(b), line * 0.8, color, 'pixel', bedPush / 2);
  for (let x = bed.min[0] + GRID_MM; x < bed.max[0] - 1e-6; x += GRID_MM) gridLine([x, bed.min[1], z], [x, bed.max[1], z], GRID);
  for (let y = bed.min[1] + GRID_MM; y < bed.max[1] - 1e-6; y += GRID_MM) gridLine([bed.min[0], y, z], [bed.max[0], y, z], GRID);
  const outline: Vec3[] = [
    [bed.min[0], bed.min[1], z],
    [bed.max[0], bed.min[1], z],
    [bed.max[0], bed.max[1], z],
    [bed.min[0], bed.max[1], z],
  ];
  outline.forEach((p, k) => gridLine(p, outline[(k + 1) % 4]!, GRID_EDGE));

  // ink on sharp creases, on the outline against the background, and on open or doubled edges
  const crease = Math.cos((EDGE_ANGLE_DEG * Math.PI) / 180);
  for (const list of edgesOf(positions, triangles).values()) {
    let draw = list.length !== 4;
    if (!draw) {
      const n1 = normals[list[0]!], n2 = normals[list[2]!];
      if (!n1 || !n2) continue;
      const f1 = dot(n1, basis.back), f2 = dot(n2, basis.back);
      draw = dot(n1, n2) < crease || (f1 > 0) !== (f2 > 0);
    }
    if (!draw) continue;
    const t = list[0]!, s = list[1]!;
    raster.line(px(corner(positions, t, s)), px(corner(positions, t, (s + 1) % 3)), line, INK, 'middle', pixels(line * 1.5));
  }

  const rgb = raster.shrink(ss);
  const label = `${partSize.map(mm).join(' x ')} mm`;
  const rowsOut = height / ss;
  const textY = rowsOut - Math.round(size * 0.05) - GLYPH_HEIGHT * labelScale;
  drawText(rgb, size, rowsOut, label, Math.round(size * 0.05), textY, labelScale, MUTED);
  return { png: encodePng(size, rowsOut, rgb), width: size, height: rowsOut, size: partSize, triangles };
}
