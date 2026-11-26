import type { Mesh } from '#checks/mesh';

export type Hit = { face: number; z: number };

/** Finds the first face straight below a point. */
export type DownRays = { below(x: number, y: number, z: number): Hit | null };

// Faces this close to vertical are edge-on to a vertical ray, so it never crosses them.
const EDGE_ON = 1e-9;

/** Sorts the faces into a grid of columns seen from above, so a ray only tests the faces of its own column. */
export function downRays(mesh: Mesh): DownRays {
  const p = mesh.positions;
  const n = mesh.normals;
  const [x0, y0] = mesh.min;
  const side = Math.max(1, Math.min(128, Math.ceil(Math.sqrt(mesh.triangles / 2))));
  const sx = (mesh.max[0] - x0) / side || 1;
  const sy = (mesh.max[1] - y0) / side || 1;
  const column = (value: number, start: number, size: number) =>
    Math.max(0, Math.min(side - 1, Math.floor((value - start) / size)));

  // every column a face lies over, by its outline seen from above
  const each = (visit: (cell: number, face: number) => void) => {
    for (let t = 0; t < mesh.triangles; t++) {
      if (Math.abs(n[t * 3 + 2]!) < EDGE_ON) continue;
      const o = t * 9;
      const i0 = column(Math.min(p[o]!, p[o + 3]!, p[o + 6]!), x0, sx);
      const i1 = column(Math.max(p[o]!, p[o + 3]!, p[o + 6]!), x0, sx);
      const j0 = column(Math.min(p[o + 1]!, p[o + 4]!, p[o + 7]!), y0, sy);
      const j1 = column(Math.max(p[o + 1]!, p[o + 4]!, p[o + 7]!), y0, sy);
      for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) visit(j * side + i, t);
    }
  };
  // count the faces per column, then fill one flat list
  const starts = new Int32Array(side * side + 1);
  each((cell) => starts[cell + 1]!++);
  for (let c = 0; c < side * side; c++) starts[c + 1]! += starts[c]!;
  const faces = new Int32Array(starts[side * side]!);
  const filled = starts.slice(0, side * side);
  each((cell, t) => {
    faces[filled[cell]!++] = t;
  });

  return {
    below(x, y, z) {
      const cell = column(y, y0, sy) * side + column(x, x0, sx);
      let best: Hit | null = null;
      for (let k = starts[cell]!; k < starts[cell + 1]!; k++) {
        const face = faces[k]!;
        const at = heightAt(p, face, x, y);
        if (at !== null && at < z && (best === null || at > best.z)) best = { face, z: at };
      }
      return best;
    },
  };
}

// The height of a face at (x, y) when the point lies over it, else null.
function heightAt(p: Float32Array, t: number, x: number, y: number): number | null {
  const o = t * 9;
  const ax = p[o]!, ay = p[o + 1]!, bx = p[o + 3]!, by = p[o + 4]!, cx = p[o + 6]!, cy = p[o + 7]!;
  const area = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
  if (area === 0) return null;
  const u = ((bx - x) * (cy - y) - (by - y) * (cx - x)) / area;
  const v = ((cx - x) * (ay - y) - (cy - y) * (ax - x)) / area;
  const w = 1 - u - v;
  const slack = -1e-9;
  if (u < slack || v < slack || w < slack) return null;
  return u * p[o + 2]! + v * p[o + 5]! + w * p[o + 8]!;
}
