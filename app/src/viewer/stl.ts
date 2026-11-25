export type Vec3 = [number, number, number];

export type Mesh = {
  positions: Float32Array;
  normals: Float32Array;
  triangles: number;
  size: Vec3;
  min: Vec3;
  max: Vec3;
};

const HEADER_BYTES = 84;
const TRIANGLE_BYTES = 50;

/** Reads a binary STL. Positions and normals hold three vertices per triangle. */
export function parseStl(buf: ArrayBuffer): Mesh {
  if (buf.byteLength < HEADER_BYTES) {
    throw new Error(`STL file is too short: ${buf.byteLength} bytes, need at least ${HEADER_BYTES}.`);
  }
  const view = new DataView(buf);
  const triangles = view.getUint32(80, true);
  const needed = HEADER_BYTES + triangles * TRIANGLE_BYTES;
  if (buf.byteLength < needed) {
    if (looksLikeText(buf)) throw new Error('This is a text STL file. Only binary STL is supported.');
    throw new Error(
      `STL file is cut short: it says ${triangles} triangles (${needed} bytes) but has ${buf.byteLength} bytes.`,
    );
  }

  const positions = new Float32Array(triangles * 9);
  const normals = new Float32Array(triangles * 9);
  const min: Vec3 = [Infinity, Infinity, Infinity];
  const max: Vec3 = [-Infinity, -Infinity, -Infinity];

  for (let t = 0; t < triangles; t++) {
    const at = HEADER_BYTES + t * TRIANGLE_BYTES + 12;
    const out = t * 9;
    for (let i = 0; i < 9; i++) {
      const value = view.getFloat32(at + i * 4, true);
      if (!Number.isFinite(value)) throw new Error(`STL triangle ${t + 1} has a value that is not a number.`);
      positions[out + i] = value;
      const axis = i % 3;
      if (value < min[axis]!) min[axis] = value;
      if (value > max[axis]!) max[axis] = value;
    }
    writeFaceNormal(positions, normals, out);
  }

  if (triangles === 0) {
    return { positions, normals, triangles, size: [0, 0, 0], min: [0, 0, 0], max: [0, 0, 0] };
  }
  const size: Vec3 = [max[0] - min[0], max[1] - min[1], max[2] - min[2]];
  return { positions, normals, triangles, size, min, max };
}

// Normals stored in STL files are often zero or stale, so work them out from the corners.
function writeFaceNormal(p: Float32Array, n: Float32Array, o: number) {
  const ux = p[o + 3]! - p[o]!;
  const uy = p[o + 4]! - p[o + 1]!;
  const uz = p[o + 5]! - p[o + 2]!;
  const vx = p[o + 6]! - p[o]!;
  const vy = p[o + 7]! - p[o + 1]!;
  const vz = p[o + 8]! - p[o + 2]!;
  let x = uy * vz - uz * vy;
  let y = uz * vx - ux * vz;
  let z = ux * vy - uy * vx;
  const length = Math.hypot(x, y, z);
  if (length > 0) {
    x /= length;
    y /= length;
    z /= length;
  }
  for (let i = 0; i < 9; i += 3) {
    n[o + i] = x;
    n[o + i + 1] = y;
    n[o + i + 2] = z;
  }
}

function looksLikeText(buf: ArrayBuffer): boolean {
  const start = new Uint8Array(buf, 0, 5);
  return String.fromCharCode(...start) === 'solid';
}

/** "80 x 62 x 70 mm, 1,240 triangles" */
export function describeMesh(mesh: Pick<Mesh, 'size' | 'triangles'>): string {
  const [x, y, z] = mesh.size.map(formatMm);
  const count = mesh.triangles.toLocaleString('en-US');
  return `${x} x ${y} x ${z} mm, ${count} ${mesh.triangles === 1 ? 'triangle' : 'triangles'}`;
}

function formatMm(value: number): string {
  return String(Math.round(value * 10) / 10);
}
