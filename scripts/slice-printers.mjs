#!/usr/bin/env node
// Slices the example parts and a 20 mm cube for every printer in the picker, in headless Chrome against a
// production build of the site, with the site's own slicer worker. Then checks every G-code file again in Node.
//   npm run fetch:kiri && node scripts/slice-printers.mjs [output folder]
// The site is built into a temporary folder with the slicer client as an extra entry, so the worker is in it
// whatever the pages import. Uses the Google Chrome installed on the machine.
// Exit code 1 when any slice fails or any file fails the check.
import { createReadStream, createWriteStream, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, extname, join, normalize } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { build } from 'vite';
import { printers } from '../app/src/slicer/printers.ts';
import { checkGcodeFile } from './check-gcode.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const app = join(root, 'app');
const out = process.argv[2] ?? mkdtempSync(join(tmpdir(), 'gkod-gcode-'));
mkdirSync(out, { recursive: true });
if (!existsSync(join(app, 'public/kiri/kiri-eng.js'))) throw new Error('Build the slicer first: npm run fetch:kiri');

const dist = mkdtempSync(join(tmpdir(), 'gkod-site-'));
await build({
  root: app,
  configFile: join(app, 'vite.config.ts'),
  logLevel: 'warn',
  build: {
    outDir: dist,
    emptyOutDir: true,
    chunkSizeWarningLimit: 4000,
    rolldownOptions: { input: { main: join(app, 'index.html'), slicer: join(app, 'src/slicer/client.ts') } },
  },
});
const assets = join(dist, 'assets');
const worker = readdirSync(assets).find((name) => name.endsWith('.js') && readFileSync(join(assets, name), 'utf8').includes('kiri-eng.js'));
if (!worker) throw new Error('No slicer worker in app/dist/assets');

// 20 mm cube as a binary STL
function cube(size = 20) {
  const v = (x, y, z) => [x * size, y * size, z * size];
  const quads = [
    [v(0, 0, 0), v(0, 1, 0), v(1, 1, 0), v(1, 0, 0)],
    [v(0, 0, 1), v(1, 0, 1), v(1, 1, 1), v(0, 1, 1)],
    [v(0, 0, 0), v(1, 0, 0), v(1, 0, 1), v(0, 0, 1)],
    [v(0, 1, 0), v(0, 1, 1), v(1, 1, 1), v(1, 1, 0)],
    [v(0, 0, 0), v(0, 0, 1), v(0, 1, 1), v(0, 1, 0)],
    [v(1, 0, 0), v(1, 1, 0), v(1, 1, 1), v(1, 0, 1)],
  ];
  const triangles = quads.flatMap(([a, b, c, d]) => [[a, b, c], [a, c, d]]);
  const buf = Buffer.alloc(84 + triangles.length * 50);
  buf.writeUInt32LE(triangles.length, 80);
  triangles.forEach((t, i) => t.flat().forEach((n, j) => buf.writeFloatLE(n, 84 + i * 50 + 12 + j * 4)));
  return buf;
}

const parts = {
  phone_stand: readFileSync(join(root, 'checks/test/fixtures/phone_stand.stl')),
  wall_hook: readFileSync(join(root, 'checks/test/fixtures/wall_hook.stl')),
  cable_clip: readFileSync(join(root, 'checks/test/fixtures/cable_clip.stl')),
  cube_20mm: cube(),
};

const page = `<!doctype html><meta charset="utf-8"><title>slice</title><script type="module">
let worker = null;
let nextId = 1;
window.runSlice = (part, settings, name) => new Promise(async (resolve) => {
  const stl = await (await fetch('/gkod/__stl/' + part)).arrayBuffer();
  worker ??= new Worker('/gkod/assets/${worker}', { type: 'module' });
  const id = nextId++;
  const began = performance.now();
  const timer = setTimeout(() => { worker.terminate(); worker = null; resolve({ ok: false, error: 'no result after 180 s' }); }, 180000);
  worker.onerror = (event) => { clearTimeout(timer); worker = null; resolve({ ok: false, error: 'worker error ' + event.message }); };
  worker.onmessage = async ({ data }) => {
    if (data.id !== id || data.type !== 'done') return;
    clearTimeout(timer);
    const ms = performance.now() - began;
    if (!data.ok) return resolve({ ok: false, error: data.error, detail: data.detail, safety: data.safety, ms });
    await fetch('/gkod/__out/' + name, { method: 'POST', body: data.gcode });
    resolve({ ok: true, ms, seconds: data.seconds, filamentMm: data.filamentMm, layers: data.layers, bytes: data.gcode.size, safetyOk: data.safety.ok, problems: data.safety.problems });
  };
  worker.postMessage({ type: 'slice', id, stl, settings }, [stl]);
});
</script>`;

const types = { '.js': 'text/javascript', '.wasm': 'application/wasm', '.html': 'text/html', '.css': 'text/css', '.json': 'application/json' };
const server = createServer(async (req, res) => {
  const path = decodeURIComponent(req.url.split('?')[0]);
  if (path === '/gkod/__slice.html') return res.writeHead(200, { 'content-type': 'text/html' }).end(page);
  if (path.startsWith('/gkod/__stl/')) return res.writeHead(200).end(parts[path.slice(12)]);
  if (path.startsWith('/gkod/__out/') && req.method === 'POST') {
    await pipeline(req, createWriteStream(join(out, path.slice(12).replace(/[^\w.-]/g, '_'))));
    return res.writeHead(204).end();
  }
  const file = normalize(join(dist, path.replace(/^\/gkod\//, '')));
  if (!file.startsWith(dist) || !existsSync(file)) return res.writeHead(404).end();
  res.writeHead(200, { 'content-type': types[extname(file)] ?? 'application/octet-stream' });
  createReadStream(file).pipe(res);
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}`;

const browser = await chromium.launch({ channel: 'chrome' });
const tab = await browser.newPage();
const errors = [];
tab.on('pageerror', (error) => errors.push(error.message));
await tab.goto(`${base}/gkod/__slice.html`);
await tab.waitForFunction(() => typeof window.runSlice === 'function');

const runs = [];
for (const printer of printers) {
  for (const part of Object.keys(parts)) runs.push({ printer, part, settings: { printerId: printer.id, quality: 'normal', infill: 15, supports: false } });
}
const first = printers[0];
runs.push({ printer: first, part: 'phone_stand', tag: 'fine-20-supports', settings: { printerId: first.id, quality: 'fine', infill: 20, supports: true } });

const rows = [];
let failed = 0;
for (const run of runs) {
  const name = `${run.printer.id}__${run.part}${run.tag ? `__${run.tag}` : ''}.gcode`;
  const result = await tab.evaluate(([part, settings, file]) => window.runSlice(part, settings, file), [run.part, run.settings, name]);
  let node = null;
  if (result.ok) node = await checkGcodeFile(join(out, name), run.printer);
  const ok = result.ok && result.safetyOk && node?.ok;
  if (!ok) failed++;
  rows.push({ file: name, printer: run.printer.name, part: run.part, settings: run.settings, ok, ...result, node: node && { ok: node.ok, problems: node.problems, stats: node.stats } });
  const hm = (s) => `${Math.floor(s / 3600)} h ${String(Math.round((s % 3600) / 60)).padStart(2, '0')} min`;
  console.log(
    result.ok
      ? `${ok ? 'pass' : 'FAIL'}  ${name}  ${(result.ms / 1000).toFixed(1)} s, ${result.layers} layers, about ${hm(result.seconds)}, ${(result.filamentMm / 1000).toFixed(2)} m, ${(result.bytes / 1e6).toFixed(2)} MB, Node check ${node.ok ? 'pass' : 'FAIL'}`
      : `FAIL  ${name}  ${result.error}${result.detail ? ` (${result.detail})` : ''}`,
  );
  for (const problem of [...(result.problems ?? result.safety?.problems ?? []), ...(node?.problems ?? [])]) {
    console.log(`      line ${problem.line}: ${problem.reason}  (${problem.text})`);
  }
}
writeFileSync(join(out, 'results.json'), JSON.stringify(rows, null, 2));
if (errors.length) console.log(`page errors: ${errors.join(' | ')}`);
console.log(`${rows.length - failed} of ${rows.length} slices passed. G-code and results.json are in ${out}`);
await browser.close();
server.close();
rmSync(dist, { recursive: true, force: true });
process.exitCode = failed || errors.length ? 1 : 0;
