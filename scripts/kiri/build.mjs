// Bundles the Kiri:Moto slicing engine as three ES modules plus its two wasm files.
// usage: node scripts/kiri/build.mjs <grid-apps source dir> <output dir> <source commit>
// Called by scripts/fetch-kiri.sh, which downloads the pinned source and installs the libraries.
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';

const [srcArg, outArg, commit] = process.argv.slice(2);
if (!srcArg || !outArg || !commit) throw new Error('usage: node build.mjs <source dir> <output dir> <source commit>');
const [src, out] = [srcArg, outArg].map((p) => path.resolve(p));
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
  metafile: true,
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
// The packages in each shim, to list them when a bundle uses the shim. jszip's own browser file contains four more.
const shimPackages = {};
for (const [entry, outfile] of [
  ['bin/webpack-three-bundle.js', 'src/ext/three.js'],
  ['gkod-jszip.js', 'src/ext/jszip-esm.js'],
  ['bin/webpack-quickjs-bundle.js', 'src/ext/quickjs.js'],
]) {
  const result = await build({ ...common, minify: false, entryPoints: [entry], outfile,
    external: [...common.external, 'fs', 'path', 'crypto', 'worker_threads'] });
  shimPackages[outfile] = used(result.metafile).packages;
}
shimPackages['src/ext/jszip-esm.js'].push('pako', 'lie', 'immediate', 'setimmediate');

// 4. The three runtime files. Our entry adds the worker client, so G-code can be read as it streams out.
await fs.writeFile('gkod-entry.js', [
  "export { Engine } from './src/kiri/run/engine.js';",
  "export { client } from './src/kiri/app/workers.js';",
  '',
].join('\n'));
await fs.rm(out, { recursive: true, force: true });
await fs.mkdir(path.join(out, 'wasm'), { recursive: true });
const bundled = { packages: new Set(['manifold-3d']), ext: new Set() };
for (const [entry, name] of [
  ['gkod-entry.js', 'kiri-eng.js'],
  ['src/kiri/run/worker.js', 'kiri-work.js'],
  ['src/kiri/run/minion.js', 'kiri-pool.js'],
]) {
  const result = await build({ ...common, plugins: [patchPlugin], entryPoints: [entry], outfile: path.join(out, name) });
  const { packages, ext } = used(result.metafile);
  for (const name of packages) bundled.packages.add(name);
  for (const file of ext) {
    bundled.ext.add(file);
    for (const name of shimPackages[file] ?? []) bundled.packages.add(name);
  }
}
await fs.copyFile('node_modules/manifold-3d/manifold.wasm', path.join(out, 'wasm', 'manifold.wasm'));
await fs.copyFile('src/wasm/kiri-geo.wasm', path.join(out, 'wasm', 'kiri-geo.wasm'));
await fs.copyFile('license.md', path.join(out, 'LICENSE-kiri-moto.md'));
await fs.writeFile(path.join(out, 'LICENSES.txt'), await licences());

const files = (await fs.readdir(out, { recursive: true })).map(String).sort();
for (const file of files) {
  const full = path.join(out, file);
  if (!(await fs.stat(full)).isFile()) continue;
  const bytes = await fs.readFile(full);
  const sum = createHash('sha256').update(bytes).digest('hex');
  console.log(`${sum}  ${String(bytes.length).padStart(8)}  ${file.split(path.sep).join('/')}`);
}

function used(metafile) {
  const packages = new Set();
  const ext = new Set();
  for (const input of Object.keys(metafile.inputs)) {
    const pkg = /node_modules\/((?:@[^/]+\/)?[^/]+)\//.exec(input);
    if (pkg) packages.add(pkg[1]);
    else if (input.startsWith('src/ext/')) ext.add(input);
  }
  return { packages: [...packages], ext: [...ext] };
}

// LICENSES.txt: Kiri:Moto's licence and the licence of every library inside the three bundles.
async function licences() {
  const rule = '-'.repeat(72);
  const upstream = JSON.parse(await fs.readFile('package.json', 'utf8'));
  const parts = [
    'Licences of the Kiri:Moto engine build in this folder',
    '',
    `Built by scripts/kiri/build.mjs in the GKod repository from GridSpace/grid-apps commit ${commit}`,
    `(https://github.com/GridSpace/grid-apps/tree/${commit}). Only the slicing engine is bundled.`,
    'Two wasm file paths were changed so the files load from this folder.',
    '',
    rule,
    `Kiri:Moto (grid-apps) ${upstream.version}`,
    `${upstream.license} (license.md and package.json)`,
    rule,
    '',
    (await fs.readFile('license.md', 'utf8')).trim(),
    '',
    'Its source files carry the header "Copyright Stewart Allen <sa@grid.space> -- All Rights Reserved",',
    'and src/moto/license.js says "Copyright (C) Stewart Allen <sa@grid.space> - All Rights Reserved" and',
    '"See the license.md file included with the source distribution". The licence file and package.json say',
    'MIT, and the readme says Kiri:Moto is "completely open source and free for use without restriction".',
  ];
  for (const name of [...bundled.packages].sort()) {
    const dir = path.join('node_modules', name);
    const info = JSON.parse(await fs.readFile(path.join(dir, 'package.json'), 'utf8'));
    const file = (await fs.readdir(dir)).find((entry) => /^(licen[cs]e|copying)(\.(md|markdown|txt))?$/i.test(entry));
    if (!file) throw new Error(`no licence file in ${name}`);
    const text = await fs.readFile(path.join(dir, file), 'utf8');
    parts.push('', rule, `${info.name} ${info.version}`, String(info.license), rule, '', text.replace(/\r\n?/g, '\n').trim());
  }
  const shims = new Set(Object.keys(shimPackages));
  for (const file of [...bundled.ext].sort()) {
    if (shims.has(file)) continue;
    const text = await fs.readFile(file, 'utf8');
    const notices = (text.match(/\/\*[\s\S]*?\*\/|(?:^[ \t]*\/\/.*\n)+/gm) ?? []).filter((block) => /licen[cs]e|copyright|source:/i.test(block));
    parts.push('', rule, `${file} (copied into the grid-apps source)`, rule, '');
    parts.push(notices.length ? notices.map((block) => block.trim()).join('\n\n') : 'No licence or copyright notice in the file.');
  }
  return `${parts.join('\n')}\n`;
}
