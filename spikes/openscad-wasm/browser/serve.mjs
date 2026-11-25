// Tiny static server for the browser test. Deliberately sends NO COOP/COEP headers,
// to show the build does not need cross-origin isolation. Usage: node browser/serve.mjs [port]
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join, extname, normalize } from 'node:path';

const root = fileURLToPath(new URL('..', import.meta.url));
const routes = [ // url prefix -> directory
  ['/vendor/', join(root, 'vendor/web/')],
  ['/parts/', join(root, 'parts/')],
  ['/', join(root, 'browser/')],
];
const types = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.wasm': 'application/wasm', '.scad': 'text/plain' };

export function start(port = 8765) {
  const server = createServer(async (req, res) => {
    let path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (path === '/') path = '/index.html';
    const [prefix, dir] = routes.find(([p]) => path.startsWith(p));
    const file = normalize(join(dir, path.slice(prefix.length)));
    if (!file.startsWith(dir)) { res.writeHead(403).end(); return; }
    try {
      const body = await readFile(file);
      res.writeHead(200, { 'Content-Type': types[extname(file)] || 'application/octet-stream',
        'Content-Length': body.length });
      res.end(body);
    } catch { res.writeHead(404).end('not found'); }
  });
  return new Promise((resolve) => server.listen(port, '127.0.0.1', () => resolve(server)));
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const port = Number(process.argv[2] || 8765);
  await start(port);
  console.log(`http://127.0.0.1:${port}/`);
}
