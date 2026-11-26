// Writes app/public/third-party-licenses.txt: the full licence text of every piece of third-party
// software and every font the site ships. Package texts come from node_modules; the rest are fetched from pinned sources.
// usage: node scripts/third-party-licenses.mjs  (after npm ci)
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'app/public/third-party-licenses.txt');

// the packages in the site bundle, as listed on the Notices page
const packages = [
  'react',
  'react-dom',
  'scheduler',
  'use-sync-external-store',
  'three',
  '@react-three/fiber',
  'zustand',
  'its-fine',
  'react-use-measure',
  'suspend-react',
];

const OPENSCAD_COMMIT = '77a103b912c69e86f6b1217bd68500d2926ed1b2';

const fetched = {
  // the npm package has no licence file, so it is taken from the same version's source
  '@react-three/fiber': 'https://raw.githubusercontent.com/pmndrs/react-three-fiber/v9.8.2/LICENSE',
};

const others = [
  {
    title: 'OpenSCAD 2026.11.23 (openscad.js and openscad.wasm)',
    licence: 'GPL-2.0-or-later, with an exception for linking with CGAL',
    url: `https://raw.githubusercontent.com/openscad/openscad/${OPENSCAD_COMMIT}/COPYING`,
  },
  {
    title: 'Manifold 3.5.4, inside openscad.wasm',
    licence: 'Apache-2.0',
    url: 'https://raw.githubusercontent.com/elalish/manifold/v3.5.4/LICENSE',
  },
  {
    title: 'Archivo font (Fontsource 5.3.0 files)',
    licence: 'OFL-1.1',
    file: join(root, 'app/src/styles/fonts/OFL-Archivo.txt'),
  },
  {
    title: 'IBM Plex Mono font (Fontsource 5.3.0 files)',
    licence: 'OFL-1.1',
    file: join(root, 'app/src/styles/fonts/OFL-IBM-Plex-Mono.txt'),
  },
  {
    title: 'GKod, and the GPL-3.0-or-later parts of CGAL 6.0.1 inside openscad.wasm',
    licence: 'GPL-3.0-or-later',
    file: join(root, 'LICENSE'),
  },
];

function packageDir(name) {
  for (const base of ['app/node_modules', 'node_modules']) {
    const dir = join(root, base, name);
    if (existsSync(join(dir, 'package.json'))) return dir;
  }
  throw new Error(`${name} is not installed; run npm ci first`);
}

async function download(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`could not fetch ${url} (${response.status})`);
  return response.text();
}

async function packageEntry(name) {
  const dir = packageDir(name);
  const info = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
  const file = readdirSync(dir).find((entry) => /^(licen[cs]e|copying)(\.(md|txt))?$/i.test(entry));
  let text;
  if (file) text = readFileSync(join(dir, file), 'utf8');
  else if (fetched[name]) text = await download(fetched[name]);
  else throw new Error(`no licence file found for ${name}`);
  return { title: `${name} ${info.version}`, licence: info.license, text };
}

const rule = '-'.repeat(72);
const entries = [];
for (const name of packages) entries.push(await packageEntry(name));
for (const other of others) {
  entries.push({ ...other, text: other.file ? readFileSync(other.file, 'utf8') : await download(other.url) });
}

const parts = [
  'Third-party licences for the GKod site',
  '',
  'The full licence text of each piece of software and each font the site ships. The list, with',
  'versions and source links, is on the Notices page and in THIRD_PARTY_NOTICES.md in the source',
  'repository. react-reconciler, copied inside @react-three/fiber, is part of React and under the',
  'same MIT licence as react below. Made by scripts/third-party-licenses.mjs.',
];
for (const entry of entries) {
  parts.push('', rule, entry.title, entry.licence, rule, '', entry.text.replace(/\r\n?/g, '\n').trim());
}
writeFileSync(out, `${parts.join('\n')}\n`);
console.log(`wrote ${entries.length} licences to app/public/third-party-licenses.txt`);
