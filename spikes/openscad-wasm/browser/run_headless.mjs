// Opens browser/index.html in headless Chromium and prints the results it reports.
// Needs: npm install (playwright-core) and a local Chrome/Chromium.
// Usage: node browser/run_headless.mjs [path-to-chrome-executable]
import { chromium } from 'playwright-core';
import { start } from './serve.mjs';

const server = await start(8765);
const exe = process.argv[2];
const browser = await chromium.launch(exe ? { executablePath: exe } : { channel: 'chrome' });
const page = await browser.newPage();
page.on('console', (m) => console.log('[console]', m.text()));
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
const requests = [];
page.on('response', async (r) => {
  const h = r.headers();
  requests.push({ url: new URL(r.url()).pathname, status: r.status(), type: h['content-type'], bytes: Number(h['content-length'] || 0) });
});
await page.goto('http://127.0.0.1:8765/');
await page.waitForFunction(() => window.__result, null, { timeout: 60000 });
const result = await page.evaluate(() => window.__result);
console.log('browser version:', browser.version());
console.log(JSON.stringify({ ...result, rows: undefined }, null, 1));
console.table(result.rows);
console.table(requests);
await browser.close();
server.close();
