// Minimal binary-STL checker: triangle count and whether the mesh is closed (watertight).
// Closed = every undirected edge is shared by exactly two triangles, and the two
// triangles traverse it in opposite directions (consistent orientation).

export function checkStl(buf) {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const n = dv.getUint32(80, true);
  if (buf.byteLength !== 84 + n * 50) {
    return { triangles: n, watertight: false, reason: 'not a binary STL / size mismatch' };
  }
  const vid = new Map();
  const idx = new Uint32Array(n * 3);
  const pos = [];
  let off = 84;
  for (let t = 0; t < n; t++) {
    off += 12; // normal
    for (let k = 0; k < 3; k++) {
      const x = dv.getFloat32(off, true), y = dv.getFloat32(off + 4, true), z = dv.getFloat32(off + 8, true);
      off += 12;
      const key = `${x},${y},${z}`;
      let id = vid.get(key);
      if (id === undefined) { id = vid.size; vid.set(key, id); pos.push(x, y, z); }
      idx[t * 3 + k] = id;
    }
    off += 2;
  }
  // directed edge counts
  const V = vid.size;
  const dir = new Map();
  let degenerate = 0;
  for (let t = 0; t < n; t++) {
    const a = idx[t * 3], b = idx[t * 3 + 1], c = idx[t * 3 + 2];
    if (a === b || b === c || a === c) degenerate++;
    for (const [u, v] of [[a, b], [b, c], [c, a]]) {
      const key = u * V + v;
      dir.set(key, (dir.get(key) || 0) + 1);
    }
  }
  let open = 0, nonManifold = 0, flipped = 0;
  for (const [key, cnt] of dir) {
    const u = Math.floor(key / V), v = key % V;
    const rev = dir.get(v * V + u) || 0;
    const total = cnt + rev;
    if (total === 1) open++;
    else if (total > 2) nonManifold++;
    else if (cnt === 2 && rev === 0) flipped++;
  }
  // signed volume and bounding box
  let vol = 0;
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (let t = 0; t < n; t++) {
    const p = [0, 1, 2].map((k) => idx[t * 3 + k] * 3);
    const [ax, ay, az] = [pos[p[0]], pos[p[0] + 1], pos[p[0] + 2]];
    const [bx, by, bz] = [pos[p[1]], pos[p[1] + 1], pos[p[1] + 2]];
    const [cx, cy, cz] = [pos[p[2]], pos[p[2] + 1], pos[p[2] + 2]];
    vol += (ax * (by * cz - bz * cy) - ay * (bx * cz - bz * cx) + az * (bx * cy - by * cx)) / 6;
  }
  for (let i = 0; i < pos.length; i += 3) for (let k = 0; k < 3; k++) {
    if (pos[i + k] < min[k]) min[k] = pos[i + k];
    if (pos[i + k] > max[k]) max[k] = pos[i + k];
  }
  // Euler characteristic V - E + F (2 per closed genus-0 shell)
  const E = [...dir.keys()].filter((key) => {
    const u = Math.floor(key / V), v = key % V;
    return u < v || !dir.has(v * V + u);
  }).length;
  return {
    triangles: n, vertices: V, edges: E, euler: V - E + n,
    openEdges: open, nonManifoldEdges: nonManifold, flippedEdges: flipped, degenerate,
    watertight: n > 0 && open === 0 && nonManifold === 0 && flipped === 0 && degenerate === 0,
    volumeMm3: Math.round(vol * 100) / 100,
    bbox: max.map((m, k) => Math.round((m - min[k]) * 1000) / 1000),
  };
}
