// Tests the hosted route: a page embeds https://grid.space/kiri/ in an iframe and drives it by postMessage.
//  A. from OUR origin (demo/frame.html on localhost): do commands run, do replies come back?
//  B. control, from grid.space's own demo page (same origin as the iframe): does export return G-code?
//  C. import grid.space's hosted engine.js module into our page, without an iframe.
// Makes a handful of ordinary page loads against grid.space. usage: node run-frame-headless.mjs
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { start } from './serve.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
fs.mkdirSync(path.join(here, 'results'), { recursive: true });
const cache = path.join(os.homedir(), 'Library/Caches/ms-playwright');
// the full browser build is used here: Kiri's own UI needs WebGL
const exe = process.env.CHROME || fs.readdirSync(cache).sort().reverse()
  .map(d => path.join(cache, d, 'chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing'))
  .find(p => fs.existsSync(p));
const server = await start(+process.env.PORT || 8766);
const browser = await chromium.launch({ executablePath: exe, headless: true, args: ['--enable-unsafe-swiftshader'] });
const results = {};

{ // A. cross-origin parent
  const page = await browser.newPage({ viewport: { width: 1000, height: 800 } });
  const logs = [], hosts = {};
  let bytes = 0;
  page.on('console', m => logs.push(m.text().slice(0, 200)));
  page.on('response', async r => {
    const h = new URL(r.url()).host; hosts[h] = (hosts[h] || 0) + 1;
    try { bytes += (await r.body()).length; } catch {}
  });
  const t0 = Date.now();
  await page.goto('http://127.0.0.1:' + server.address().port + '/demo/frame.html');
  await page.waitForFunction(() => window.frameLoaded, null, { timeout: 60000 });
  await page.waitForTimeout(6000); // let the embedded app finish starting
  const post = m => page.evaluate(m => document.getElementById('kiri').contentWindow.postMessage(m, '*'), m);
  await post({ mode: 'FDM' }); await post({ clear: true });
  for (const e of ['loaded', 'slice.done', 'prepare.done', 'export.done']) await post({ event: e });
  await post({ load: '/obj/cube.stl' });            await page.waitForTimeout(5000);
  await post({ function: 'slice', callback: true });   await page.waitForTimeout(6000);
  await post({ function: 'prepare', callback: true }); await page.waitForTimeout(5000);
  await post({ function: 'export', callback: true });  await page.waitForTimeout(5000);
  results.crossOrigin = {
    iframeVersion: logs.find(l => l.includes('init main')),
    sliceRanInsideIframe: logs.some(l => l.includes('slicing')),
    prepareRanInsideIframe: logs.some(l => l.includes('prepare')),
    eventsReceivedByOurPage: await page.evaluate(() => window.frameEvents.length),
    requestsPerHost: hosts, bytesDownloaded: bytes, totalMs: Date.now() - t0,
  };
  await page.screenshot({ path: path.join(here, 'results', 'frame-cross-origin.png') });
  await page.close();
}

{ // B. same-origin control on grid.space's own demo page
  const page = await browser.newPage();
  await page.goto('https://grid.space/kiri/frame.html');
  await page.waitForTimeout(8000);
  results.sameOriginControl = await page.evaluate(() => new Promise(ok => {
    const api = kiri.frame, t0 = performance.now(), seen = [];
    api.setMode('FDM'); api.clear(); api.load('/obj/cube.stl');
    api.on('loaded', () => { seen.push('loaded'); api.slice(); });
    api.on('slice.done', () => { seen.push('slice.done'); api.prepare(); });
    api.on('prepare.done', () => { seen.push('prepare.done'); api.export(true); });
    api.on('export.done', d => ok({ events: [...seen, 'export.done'], ms: Math.round(performance.now() - t0),
      returnType: typeof d, gcodeChars: String(d).length, firstLine: String(d).split('\n')[0] }));
    setTimeout(() => ok({ events: seen, timeout: true }), 40000);
  }));
  await page.close();
}
{ // C. import grid.space's hosted engine module straight into our page (no iframe)
  const page = await browser.newPage();
  const logs = [];
  page.on('console', m => logs.push(m.text().slice(0, 160)));
  await page.goto('http://127.0.0.1:' + server.address().port + '/demo/blank.html');
  const r = await page.evaluate(async () => {
    try {
      const { Engine } = await import('https://grid.space/lib/kiri/run/engine.js');
      const buf = await (await fetch('/demo/part.stl')).arrayBuffer();
      const eng = new Engine({ workURL: 'https://grid.space/lib/kiri/run/worker.js', poolURL: 'https://grid.space/lib/kiri/run/minion.js' });
      await eng.parse(buf);
      const g = await Promise.race([eng.slice().then(e => e.prepare()).then(e => e.export()),
        new Promise(ok => setTimeout(() => ok(null), 15000))]);
      return { moduleImported: true, gcodeChars: g ? g.length : 0, timedOutAfter15s: !g };
    } catch (e) { return { moduleImported: false, error: String(e?.message || e).slice(0, 200) }; }
  });
  results.hostedEngineModule = { ...r, workerError: logs.find(l => l.includes('Worker')) };
  await page.close();
}
console.log(JSON.stringify(results, null, 1));
fs.writeFileSync(path.join(here, 'results', 'frame-results.json'), JSON.stringify(results, null, 1));
await browser.close(); server.close();
