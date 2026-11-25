// Compile the three test parts, cold (first compile in this process) and warm, and check the meshes.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { compile } from './compile.mjs';
import { checkStl } from './meshcheck.mjs';

const here = new URL('.', import.meta.url);
const parts = ['box_hole', 'phone_stand', 'plate_40_holes'];
const WARM_RUNS = 5;
mkdirSync(new URL('out/', here), { recursive: true });
const median = (a) => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)];
const build = process.argv[2] || 'web';
const only = process.argv[3];
const rows = [];
for (const name of parts) {
  if (only && only !== name) continue;
  const src = readFileSync(new URL(`parts/${name}.scad`, here), 'utf8');
  const first = await compile(src, { build });
  if (!first.ok) { console.error(name, 'FAILED', first.log); continue; }
  const warm = [];
  for (let i = 0; i < WARM_RUNS; i++) warm.push((await compile(src, { build })).ms);
  writeFileSync(new URL(`out/${name}.stl`, here), first.stl);
  const mesh = checkStl(first.stl);
  rows.push({
    part: name,
    first_ms: Math.round(first.ms.total),
    first_init_ms: Math.round(first.ms.init),
    warm_ms: Math.round(median(warm.map((m) => m.total))),
    warm_init_ms: Math.round(median(warm.map((m) => m.init))),
    warm_run_ms: Math.round(median(warm.map((m) => m.run))),
    stl_kb: Math.round(first.stl.length / 1024),
    triangles: mesh.triangles, watertight: mesh.watertight,
    open: mesh.openEdges, nonManifold: mesh.nonManifoldEdges,
    euler: mesh.euler, volume_mm3: mesh.volumeMm3, bbox: mesh.bbox.join(' x '),
    warnings: first.warnings.length,
  });
}
console.log(`build=${build} node=${process.version}`);
console.table(rows);
