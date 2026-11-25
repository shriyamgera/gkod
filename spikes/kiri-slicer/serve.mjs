// Tiny static file server for this folder (no dependencies). usage: node serve.mjs [port]
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.dirname(fileURLToPath(import.meta.url));
const types = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json',
  '.wasm': 'application/wasm', '.stl': 'model/stl', '.obj': 'text/plain', '.3mf': 'model/3mf', '.md': 'text/plain' };
export function start(port = 8765) {
  const server = http.createServer((req, res) => {
    let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (p === '/') p = '/demo/index.html';
    // the engine asks for ../wasm/manifold.wasm, which resolves to /wasm/ from both /demo/ and /kiri/
    if (p.startsWith('/wasm/')) p = '/kiri' + p;
    const file = path.join(root, path.normalize(p));
    if (!file.startsWith(root) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      res.writeHead(404); return res.end('not found');
    }
    res.writeHead(200, { 'content-type': types[path.extname(file)] || 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
  });
  return new Promise(ok => server.listen(port, '127.0.0.1', () => ok(server)));
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const port = +process.argv[2] || 8765;
  start(port).then(() => console.log(`http://127.0.0.1:${port}/`));
}
