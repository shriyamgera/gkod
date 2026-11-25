// Drives demo/index.html in headless Chromium and records what actually came back.
// usage: node run-headless.mjs            (uses a Chromium already in the Playwright cache)
//        CHROME=/path/to/chrome node run-headless.mjs
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { start } from './serve.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const out = path.join(here, 'out');          // G-code files (git-ignored, about 19 MB)
const res = path.join(here, 'results');      // small result files that are kept
fs.mkdirSync(out, { recursive: true });
fs.mkdirSync(res, { recursive: true });

function findChrome() {
  if (process.env.CHROME) return process.env.CHROME;
  const cache = path.join(os.homedir(), 'Library/Caches/ms-playwright');
  const dirs = fs.existsSync(cache) ? fs.readdirSync(cache).sort().reverse() : [];
  for (const d of dirs) {
    for (const rel of ['chrome-headless-shell-mac-arm64/chrome-headless-shell',
                       'chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing',
                       'chrome-mac/Chromium.app/Contents/MacOS/Chromium']) {
      const p = path.join(cache, d, rel);
      if (fs.existsSync(p)) return p;
    }
  }
  throw new Error('no cached Chromium found; set CHROME=/path/to/chrome');
}

const cases = (process.env.CASES ? JSON.parse(process.env.CASES) : null) || [
  { name: 'base-0.2-2w-20pct',      layerHeight: 0.2, walls: 2, infill: 0.2 },
  { name: 'base-repeat',            layerHeight: 0.2, walls: 2, infill: 0.2 },
  { name: 'layer-0.1',              layerHeight: 0.1, walls: 2, infill: 0.2 },
  { name: 'walls-4',                layerHeight: 0.2, walls: 4, infill: 0.2 },
  { name: 'infill-60',              layerHeight: 0.2, walls: 2, infill: 0.6 },
  { name: 'solid-100',              layerHeight: 0.2, walls: 2, infill: 1 },
  { name: 'solid-100-flow-1.0',     layerHeight: 0.2, walls: 2, infill: 1, process: { outputShellMult: 1, outputFillMult: 1, outputSparseMult: 1 } },
  { name: 'gyroid-80 (hangs)',      layerHeight: 0.2, walls: 2, infill: 0.8, timeoutMs: 60000 },
  { name: 'grid-80',                layerHeight: 0.2, walls: 2, infill: 0.8, infillType: 'grid' },
  { name: 'zone-walls-10-30',       layerHeight: 0.2, walls: 2, infill: 0.2, zones: [{ fromLayer: 10, toLayer: 30, walls: 5 }] },
  { name: 'zone-walls+infill-10-30', layerHeight: 0.2, walls: 2, infill: 0.2, zones: [{ fromLayer: 10, toLayer: 30, walls: 5, infill: 0.5 }] },
  { name: 'overhang-no-support',    file: 'overhang.stl', layerHeight: 0.2, walls: 2, infill: 0.2, supports: false },
  { name: 'overhang-support',       file: 'overhang.stl', layerHeight: 0.2, walls: 2, infill: 0.2, supports: true },
  { name: 'printer-klipper',        printer: 'Any.Generic.Klipper', layerHeight: 0.2, walls: 2, infill: 0.2 },
  { name: 'printer-bambu-a1',       printer: 'Bambu.A1', layerHeight: 0.2, walls: 2, infill: 0.2 },
  { name: 'printer-bambu-p1s',      printer: 'Bambu.P1S', layerHeight: 0.2, walls: 2, infill: 0.2 },
  { name: 'custom-printer',         layerHeight: 0.2, walls: 2, infill: 0.2, bed: { w: 180, d: 180, h: 180 }, nozzle: 0.6,
    startGcode: ['; SHILP-START', 'G90', 'M83', 'G28', 'M104 S{temp}', 'M140 S{bed_temp}', 'G92 E0'], endGcode: ['; SHILP-END', 'M104 S0', 'M84'] },
  { name: 'format-obj',             file: 'part.obj', layerHeight: 0.2, walls: 2, infill: 0.2 },
  { name: 'format-3mf',             file: 'part.3mf', layerHeight: 0.2, walls: 2, infill: 0.2 },
];

const server = await start(+process.env.PORT || 8765);
const exe = findChrome();
const browser = await chromium.launch({ executablePath: exe, headless: true });
const results = { chromium: exe.replace(os.homedir(), '~'), version: browser.version(), cases: [] };
const requests = new Set();

for (const c of cases) {
  // a fresh page per case, so every timing includes loading the engine and starting its workers
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('request', r => requests.add(new URL(r.url()).host));
  const t0 = Date.now();
  await page.goto('http://127.0.0.1:' + server.address().port + '/demo/index.html');
  await page.waitForFunction(() => document.body.dataset.ready === '1');
  const row = { name: c.name };
  try {
    const { summary, gcode } = await Promise.race([
      page.evaluate(o => window.runSlice(o), c),
      new Promise((_, no) => setTimeout(() => no(new Error(`no result after ${(c.timeoutMs || 120000) / 1000} s`)), c.timeoutMs || 120000)),
    ]);
    fs.writeFileSync(path.join(out, c.name.replace(/[^\w.+-]+/g, '_') + '.gcode'), gcode);
    const shown = await page.$eval('#gcode', t => t.value.length);
    Object.assign(row, {
      ok: true, wallMs: Date.now() - t0, gcodeCharsInTextarea: shown, gcodeLines: summary.gcodeLines,
      kiri: summary.kiri, filamentGrams: summary.filamentGrams, ms: summary.ms, fromGcode: summary.fromGcode,
      head: gcode.split(/\r?\n/).slice(0, 4), tail: gcode.split(/\r?\n/).slice(-4),
    });
    if (c.name === 'base-0.2-2w-20pct') await page.screenshot({ path: path.join(res, 'demo.png'), fullPage: true });
  } catch (e) {
    Object.assign(row, { ok: false, error: String(e) });
  }
  if (errors.length) row.pageErrors = errors.slice(0, 5);
  results.cases.push(row);
  const k = row.kiri || {};
  console.log(`${row.ok ? 'ok  ' : 'FAIL'} ${c.name.padEnd(24)} total ${String(Math.round(row.ms?.total ?? 0)).padStart(5)} ms  ` +
    `lines ${String(row.gcodeLines ?? '-').padStart(6)}  layers ${String(row.fromGcode?.layers ?? '-').padStart(4)}  ` +
    `time ${k.printTimeSec?.toFixed?.(0) ?? '-'} s  filament ${k.filamentMM?.toFixed?.(1) ?? '-'} mm  ${row.error || ''}`);
  await page.close();
}
results.hostsContacted = [...requests];
fs.writeFileSync(path.join(res, 'results.json'), JSON.stringify(results));
console.log('hosts contacted:', results.hostsContacted.join(', '));
await browser.close();
server.close();
