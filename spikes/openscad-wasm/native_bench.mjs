// Same measurements with a native OpenSCAD binary, for comparison with the WebAssembly build.
// Usage: node native_bench.mjs /path/to/OpenSCAD.app/Contents/MacOS/OpenSCAD [workers=8] [seconds=12]
import { spawn, execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { rng, TEMPLATES } from './templates.mjs';
import { checkStl } from './meshcheck.mjs';

const bin = process.argv[2];
const nWorkers = Number(process.argv[3] || 8);
const seconds = Number(process.argv[4] || 12);
const here = fileURLToPath(new URL('.', import.meta.url));
const tmp = mkdtempSync(join(tmpdir(), 'scad-native-'));

function run(inFile, outFile, extra = []) {
  return new Promise((resolve) => {
    const t0 = performance.now();
    const p = spawn(bin, [inFile, '-o', outFile, '--export-format=binstl', '--backend=manifold', ...extra]);
    let err = '';
    p.stderr.on('data', (d) => { err += d; });
    p.on('close', (code) => resolve({ code, err, ms: performance.now() - t0 }));
  });
}

console.log(execFileSync(bin, ['--version'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim() ||
  'version printed on stderr');
const rows = [];
for (const name of ['box_hole', 'phone_stand', 'plate_40_holes']) {
  const out = join(tmp, `${name}.stl`);
  const times = [];
  let last;
  for (let i = 0; i < 5; i++) { last = await run(join(here, 'parts', `${name}.scad`), out); times.push(last.ms); }
  const mesh = checkStl(new Uint8Array(readFileSync(out)));
  rows.push({ part: name, first_ms: Math.round(times[0]), median_ms: Math.round([...times].sort((a, b) => a - b)[2]),
    triangles: mesh.triangles, watertight: mesh.watertight, volume_mm3: mesh.volumeMm3,
    warnings: (last.err.match(/^WARNING/gm) || []).length });
}
console.table(rows);

const bad = await run(join(here, 'parts', 'broken.scad'), join(tmp, 'broken.stl'));
console.log(`broken.scad: exit code ${bad.code}; stderr: ${bad.err.trim().split('\n').join(' | ')}`);

// throughput: nWorkers loops, each spawning one process per part
let compiles = 0, ok = 0, watertight = 0;
const t0 = performance.now();
await Promise.all(Array.from({ length: nWorkers }, async (_, id) => {
  const rand = rng(1000 + id);
  const names = Object.keys(TEMPLATES);
  const inFile = join(tmp, `w${id}.scad`), outFile = join(tmp, `w${id}.stl`);
  let n = 0;
  while (performance.now() - t0 < seconds * 1000) {
    writeFileSync(inFile, TEMPLATES[names[n++ % names.length]](rand));
    if (existsSync(outFile)) rmSync(outFile);
    const r = await run(inFile, outFile, ['--hardwarnings']);
    compiles++;
    if (r.code === 0 && existsSync(outFile)) { ok++; if (checkStl(new Uint8Array(readFileSync(outFile))).watertight) watertight++; }
  }
}));
const wall = (performance.now() - t0) / 1000;
console.log(JSON.stringify({ native: true, workers: nWorkers, wall_s: Math.round(wall * 10) / 10, compiles, ok, watertight,
  compiles_per_min: Math.round(compiles / wall * 60) }));
rmSync(tmp, { recursive: true, force: true });
