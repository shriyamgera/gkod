// Bundle the Kiri:Moto engine, worker and worker-pool ("minion") as three ES modules.
// usage: node build-kiri.mjs <grid-apps source dir> <output dir>
import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';

const [src, out] = process.argv.slice(2).map(p => path.resolve(p));
const require = createRequire(path.join(src, 'x.js'));
const { build } = require('esbuild');
process.chdir(src);

// 1. device profiles -> src/pack/kiri-devs.js (same as upstream bin/esbuild.config.mjs)
const devs = {};
const root = 'src/kiri/dev';
for (const type of await fs.readdir(root)) {
  devs[type] = {};
  for (const f of await fs.readdir(path.join(root, type))) {
    devs[type][f.replace(/\.json$/, '')] = JSON.parse(await fs.readFile(path.join(root, type, f)));
  }
}
await fs.mkdir('src/pack', { recursive: true });
await fs.writeFile('src/pack/kiri-devs.js', `export const devices = ${JSON.stringify(devs)};`);
await fs.mkdir(out, { recursive: true });
await fs.writeFile(path.join(out, 'devices.json'), JSON.stringify(devs));

const common = {
  bundle: true, format: 'esm', platform: 'browser', target: 'es2022',
  minify: true, sourcemap: false, logLevel: 'warning',
  // QTS_DEBUG: quickjs-emscripten reads process.env at load time; there is no process in a browser
  define: { 'process.env.NODE_ENV': '"prod"', 'process.env.QTS_DEBUG': 'false' },
  logOverride: { 'duplicate-class-member': 'silent', 'duplicate-object-key': 'silent', 'direct-eval': 'silent' },
  // same externals as upstream bin/esbuild.config.mjs (dead require() calls inside src/ext/jspoly.js)
  external: ['module', 'node:module', './constants', './voronoi_structures', './voronoi_ctypes',
    '../thirdparty/jsbn', './collections', './voronoi_predicates', './voronoi_builder', './point_data',
    './segment_data', './cppgen', './voronoi_diagram', './voronoi'],
};

// 2. library shims that upstream makes with webpack (three, jszip, quickjs).
//    jszip gets its own entry: upstream's does "import * as JSZip", which esbuild turns into a
//    namespace object, and then "new JSZip()" (used by the 3MF loader) fails.
await fs.writeFile('gkod-jszip.js', `
import JSZip from './node_modules/jszip/dist/jszip.js';
export default JSZip;
export { JSZip };
`);
for (const [entry, outfile] of [
  ['bin/webpack-three-bundle.js', 'src/ext/three.js'],
  ['gkod-jszip.js', 'src/ext/jszip-esm.js'],
  ['bin/webpack-quickjs-bundle.js', 'src/ext/quickjs.js'],
]) {
  await build({ ...common, minify: false, entryPoints: [entry], outfile,
    external: [...common.external, 'fs', 'path', 'crypto', 'worker_threads'] });
}

// 3. the three runtime files. Our entry re-exports the upstream Engine plus the
//    mesh loaders (OBJ, 3MF) that the Engine class itself does not expose.
await fs.writeFile('gkod-entry.js', `
export { Engine } from './src/kiri/run/engine.js';
export { load_data } from './src/load/file.js';
`);
for (const [entry, name] of [
  ['gkod-entry.js', 'kiri-eng.js'],
  ['src/kiri/run/worker.js', 'kiri-work.js'],
  ['src/kiri/run/minion.js', 'kiri-pool.js'],
]) {
  await build({ ...common, entryPoints: [entry], outfile: path.join(out, name) });
}
// 4. wasm files. manifold.wasm is required and is requested as ../wasm/manifold.wasm (= /wasm/ in the demo).
//    kiri-geo.wasm (optional faster clipping) was never requested in our runs; copied for completeness.
await fs.mkdir(path.join(out, 'wasm'), { recursive: true });
await fs.copyFile('src/wasm/kiri-geo.wasm', path.join(out, 'wasm', 'kiri-geo.wasm'));
await fs.copyFile('node_modules/manifold-3d/manifold.wasm', path.join(out, 'wasm', 'manifold.wasm'));
await fs.copyFile('license.md', path.join(out, 'LICENSE-kiri-moto.md'));
for (const f of await fs.readdir(out, { recursive: true })) {
  const s = await fs.stat(path.join(out, f));
  if (s.isFile()) console.log(String(s.size).padStart(9), f);
}
