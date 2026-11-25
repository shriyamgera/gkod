import { BufferAttribute, BufferGeometry, Color, EdgesGeometry } from 'three';
import { type Bounds, bedArea, GRID_MM } from './grid';
import type { Mesh } from './stl';

// Faces are shaded by which way they point, from a fixed direction, so the part
// reads as flat paper tones with no lights or gloss.
const LIGHT = normalise([0.15, -0.45, 0.88]);
const TONES: [number, Color][] = [
  [0, new Color('#9e998d')],
  [0.55, new Color('#bfbaaf')],
  [0.72, new Color('#ddd9d0')],
  [0.94, new Color('#ffffff')],
];
const EDGE_ANGLE = 28;

export function partGeometry(mesh: Mesh): BufferGeometry {
  const colors = new Float32Array(mesh.positions.length);
  const tone = new Color();
  for (let i = 0; i < mesh.normals.length; i += 9) {
    const facing =
      mesh.normals[i]! * LIGHT[0] + mesh.normals[i + 1]! * LIGHT[1] + mesh.normals[i + 2]! * LIGHT[2];
    toneFor((facing + 1) / 2, tone);
    for (let v = 0; v < 9; v += 3) {
      colors[i + v] = tone.r;
      colors[i + v + 1] = tone.g;
      colors[i + v + 2] = tone.b;
    }
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(mesh.positions, 3));
  geometry.setAttribute('color', new BufferAttribute(colors, 3));
  return geometry;
}

/** Outline of the part: only edges where the surface bends sharply. */
export function edgeGeometry(part: BufferGeometry): BufferGeometry {
  return new EdgesGeometry(part, EDGE_ANGLE);
}

/** Print-bed grid under the part, one line every GRID_MM millimetres. */
export function bedGeometry(part: Bounds): { lines: BufferGeometry; outline: BufferGeometry } {
  const { min, max } = bedArea(part);
  const [x0, y0, z] = min;
  const [x1, y1] = max;

  const inner: number[] = [];
  for (let x = x0 + GRID_MM; x < x1; x += GRID_MM) inner.push(x, y0, z, x, y1, z);
  for (let y = y0 + GRID_MM; y < y1; y += GRID_MM) inner.push(x0, y, z, x1, y, z);
  const edge = [x0, y0, z, x1, y0, z, x1, y0, z, x1, y1, z, x1, y1, z, x0, y1, z, x0, y1, z, x0, y0, z];

  return { lines: segments(inner), outline: segments(edge) };
}

function segments(points: number[]): BufferGeometry {
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(new Float32Array(points), 3));
  return geometry;
}

function toneFor(t: number, out: Color) {
  let lower = TONES[0]!;
  for (const upper of TONES) {
    if (t <= upper[0]) {
      const span = upper[0] - lower[0];
      out.copy(lower[1]).lerp(upper[1], span > 0 ? (t - lower[0]) / span : 0);
      return;
    }
    lower = upper;
  }
  out.copy(lower[1]);
}

function normalise(v: [number, number, number]): [number, number, number] {
  const length = Math.hypot(...v);
  return [v[0] / length, v[1] / length, v[2] / length];
}
