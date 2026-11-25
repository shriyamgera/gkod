// Offline data-generation throughput: N worker threads, each compiling program-made parts
// (fixed templates + random sizes) with the WebAssembly build and checking the mesh.
// Usage: node throughput.mjs [workers=4] [seconds=15] [mix|simple|plate|rounded|bracket]
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import { cpus } from 'node:os';

import { rng, TEMPLATES } from './templates.mjs';

if (isMainThread) {
  const nWorkers = Number(process.argv[2] || 4);
  const seconds = Number(process.argv[3] || 15);
  const kind = process.argv[4] || 'mix';
  const t0 = performance.now();
  const results = await Promise.all(Array.from({ length: nWorkers }, (_, i) => new Promise((resolve, reject) => {
    const w = new Worker(new URL(import.meta.url), { workerData: { id: i, seconds, kind } });
    w.once('message', resolve); w.once('error', reject);
  })));
  const wall = (performance.now() - t0) / 1000;
  const sum = (k) => results.reduce((a, r) => a + r[k], 0);
  const compiles = sum('compiles');
  console.log(JSON.stringify({
    workers: nWorkers, cores: cpus().length, kind, seconds_measured: Math.round(sum('busy_s') / nWorkers * 10) / 10,
    wall_s: Math.round(wall * 10) / 10, compiles, ok: sum('ok'), watertight: sum('watertight'),
    compiles_per_min: Math.round(compiles / (sum('busy_s') / nWorkers) * 60),
    avg_ms_per_compile_per_worker: Math.round(sum('busy_s') * 1000 / compiles * 10) / 10,
    avg_triangles: Math.round(sum('triangles') / Math.max(1, sum('ok'))),
    peak_rss_mb: Math.round(Math.max(...results.map((r) => r.rss_mb))),
  }));
  if (process.env.SHOW_BAD) for (const r of results) for (const b of r.bad) console.log(JSON.stringify(b, null, 1));
} else {
  const { compile } = await import('./compile.mjs');
  const { checkStl } = await import('./meshcheck.mjs');
  const { id, seconds, kind } = workerData;
  const rand = rng(1000 + id);
  const names = kind === 'mix' ? Object.keys(TEMPLATES) : [kind];
  await compile('cube(1);'); // warm up: load and compile the wasm module (not counted)
  let compiles = 0, ok = 0, watertight = 0, triangles = 0;
  const bad = [];
  const t0 = performance.now();
  while (performance.now() - t0 < seconds * 1000) {
    const src = TEMPLATES[names[compiles % names.length]](rand);
    const r = await compile(src, { extraArgs: ['--hardwarnings'] });
    compiles++;
    if (r.ok) { ok++; const m = checkStl(r.stl); triangles += m.triangles; if (m.watertight) watertight++; else bad.push({ src, mesh: m }); }
    else bad.push({ src, log: r.log.slice(0, 4) });
  }
  parentPort.postMessage({ bad: bad.slice(0, 2), compiles, ok, watertight, triangles, busy_s: (performance.now() - t0) / 1000,
    rss_mb: process.memoryUsage().rss / 1048576 });
}
