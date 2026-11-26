// Bundles the Kiri:Moto slicing engine as three ES modules plus its two wasm files.
// usage: node scripts/kiri/build.mjs <grid-apps source dir> <output dir>
// Called by scripts/fetch-kiri.sh, which downloads the pinned source and installs the libraries.
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';

const [src, out] = process.argv.slice(2).map((p) => path.resolve(p));
if (!src || !out) throw new Error('usage: node build.mjs <source dir> <output dir>');
const require = createRequire(path.join(src, 'x.js'));
const { build } = require('esbuild');
process.chdir(src);

// 1. Printer profiles, as upstream bin/esbuild.config.mjs makes them. Sorted so every machine writes the same file.
const devs = {};
const devRoot = 'src/kiri/dev';
for (const type of (await fs.readdir(devRoot)).sort()) {
  devs[type] = {};
  for (const file of (await fs.readdir(path.join(devRoot, type))).sort()) {
    if (!file.endsWith('.json')) continue;
    devs[type][file.replace(/\.json$/, '')] = JSON.parse(await fs.readFile(path.join(devRoot, type, file), 'utf8'));
  }
}
await fs.mkdir('src/pack', { recursive: true });
await fs.writeFile('src/pack/kiri-devs.js', `export const devices = ${JSON.stringify(devs)};`);

// 2. Two wasm paths that point at the site root. They are made relative to the bundle, which sits next to its wasm folder.
const patches = [
  { file: 'src/geo/csg.js', from: '"../wasm/manifold.wasm"', to: 'new URL("./wasm/manifold.wasm", import.meta.url).href' },
  { file: 'src/geo/wasm.js', from: "fetch('/wasm/kiri-geo.wasm')", to: "fetch(new URL('./wasm/kiri-geo.wasm', import.meta.url))" },
];
const patchPlugin = {
  name: 'gkod-paths',
  setup(b) {
    b.onLoad({ filter: /src[\\/]geo[\\/](csg|wasm)\.js$/ }, async (args) => {
      let text = await fs.readFile(args.path, 'utf8');
      for (const p of patches) {
        if (!args.path.endsWith(path.normalize(p.file))) continue;
        if (!text.includes(p.from)) throw new Error(`${p.file} no longer contains ${p.from}`);
        text = text.replace(p.from, p.to);
      }
      return { contents: text, loader: 'js' };
    });
  },
};

const common = {
  absWorkingDir: src,
  bundle: true,
  format: 'esm',
  platform: 'browser',
  target: 'es2022',
  minify: true,
  sourcemap: false,
  legalComments: 'eof',
  logLevel: 'warning',
  // quickjs-emscripten reads process.env when it loads; there is no process in a browser
  define: { 'process.env.NODE_ENV': '"prod"', 'process.env.QTS_DEBUG': 'false' },
  logOverride: { 'duplicate-class-member': 'silent', 'duplicate-object-key': 'silent', 'direct-eval': 'silent' },
  // the same externals as upstream bin/esbuild.config.mjs (dead require() calls inside src/ext/jspoly.js)
  external: ['module', 'node:module', './constants', './voronoi_structures', './voronoi_ctypes',
    '../thirdparty/jsbn', './collections', './voronoi_predicates', './voronoi_builder', './point_data',
    './segment_data', './cppgen', './voronoi_diagram', './voronoi'],
};

// 3. Library shims that upstream makes with webpack. jszip gets its own entry: upstream's
//    "import * as JSZip" becomes a namespace object in esbuild, and "new JSZip()" then fails.
await fs.writeFile('gkod-jszip.js', [
  "import JSZip from './node_modules/jszip/dist/jszip.js';",
  'export default JSZip;',
  'export { JSZip };',
  '',
].join('\n'));
for (const [entry, outfile] of [
  ['bin/webpack-three-bundle.js', 'src/ext/three.js'],
  ['gkod-jszip.js', 'src/ext/jszip-esm.js'],
  ['bin/webpack-quickjs-bundle.js', 'src/ext/quickjs.js'],
]) {
  await build({ ...common, minify: false, entryPoints: [entry], outfile,
    external: [...common.external, 'fs', 'path', 'crypto', 'worker_threads'] });
}

// 4. The three runtime files. Our entry adds the worker client, so G-code can be read as it streams out.
await fs.writeFile('gkod-entry.js', [
  "export { Engine } from './src/kiri/run/engine.js';",
  "export { client } from './src/kiri/app/workers.js';",
  '',
].join('\n'));
await fs.rm(out, { recursive: true, force: true });
await fs.mkdir(path.join(out, 'wasm'), { recursive: true });
for (const [entry, name] of [
  ['gkod-entry.js', 'kiri-eng.js'],
  ['src/kiri/run/worker.js', 'kiri-work.js'],
  ['src/kiri/run/minion.js', 'kiri-pool.js'],
]) {
  await build({ ...common, plugins: [patchPlugin], entryPoints: [entry], outfile: path.join(out, name) });
}
await fs.copyFile('node_modules/manifold-3d/manifold.wasm', path.join(out, 'wasm', 'manifold.wasm'));
await fs.copyFile('src/wasm/kiri-geo.wasm', path.join(out, 'wasm', 'kiri-geo.wasm'));
await fs.copyFile('license.md', path.join(out, 'LICENSE-kiri-moto.md'));

const files = (await fs.readdir(out, { recursive: true })).map(String).sort();
for (const file of files) {
  const full = path.join(out, file);
  if (!(await fs.stat(full)).isFile()) continue;
  const bytes = await fs.readFile(full);
  const sum = createHash('sha256').update(bytes).digest('hex');
  console.log(`${sum}  ${String(bytes.length).padStart(8)}  ${file.split(path.sep).join('/')}`);
}
