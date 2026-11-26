import type { CSSProperties, ReactNode } from 'react';

const OPENSCAD_COMMIT = '77a103b912c69e86f6b1217bd68500d2926ed1b2';
const OPENSCAD_REPO = 'https://github.com/openscad/openscad';
const OPENSCAD_ZIP = 'https://files.openscad.org/snapshots/OpenSCAD-2026.11.23-WebAssembly-web.zip';
const GKOD_REPO = 'https://github.com/shriyamgera/gkod';
const LICENCE_TEXTS = `${import.meta.env.BASE_URL}third-party-licenses.txt`;
const KIRI_COMMIT = '47efc37eca9a387dfdcd2990273fae6b9680cb64';
const KIRI_REPO = 'https://github.com/GridSpace/grid-apps';
const KIRI_TEXTS = `${import.meta.env.BASE_URL}kiri/LICENSES.txt`;

type Item = { name: string; version?: string; licence: string; href: string; note?: string };

const insideOpenscad: Item[] = [
  {
    name: 'Manifold',
    version: '3.5.4',
    licence: 'Apache-2.0',
    href: 'https://github.com/elalish/manifold',
  },
  {
    name: 'CGAL',
    version: '6.0.1',
    licence: 'GPL-3.0-or-later and LGPL-3.0-or-later',
    href: 'https://github.com/CGAL/cgal/blob/v6.0.1/Installation/LICENSE',
    note: 'The licence is set per file. The parts OpenSCAD uses for solid geometry are GPL-3.0-or-later.',
  },
];

const packages: Item[] = [
  { name: 'React', version: '19.3.1', licence: 'MIT', href: 'https://github.com/react/react', note: 'react, react-dom' },
  { name: 'scheduler', version: '0.28.0', licence: 'MIT', href: 'https://github.com/react/react', note: 'Part of React.' },
  {
    name: 'three.js',
    version: '0.187.0',
    licence: 'MIT',
    href: 'https://github.com/mrdoob/three.js',
    note: 'With its OrbitControls add-on.',
  },
  {
    name: 'react-three-fiber',
    version: '9.8.2',
    licence: 'MIT',
    href: 'https://github.com/pmndrs/react-three-fiber',
  },
];

const withFiber: Item[] = [
  {
    name: 'react-reconciler',
    version: 'from React 19.3.0',
    licence: 'MIT',
    href: 'https://github.com/react/react',
    note: "Part of React. A copy is inside react-three-fiber's own files.",
  },
  { name: 'zustand', version: '5.1.0', licence: 'MIT', href: 'https://github.com/pmndrs/zustand' },
  { name: 'its-fine', version: '2.1.1', licence: 'MIT', href: 'https://github.com/pmndrs/its-fine' },
  { name: 'react-use-measure', version: '2.1.7', licence: 'MIT', href: 'https://github.com/pmndrs/react-use-measure' },
  { name: 'suspend-react', version: '0.1.3', licence: 'MIT', href: 'https://github.com/pmndrs/suspend-react' },
  {
    name: 'use-sync-external-store',
    version: '1.7.0',
    licence: 'MIT',
    href: 'https://github.com/react/react',
    note: 'Part of React.',
  },
];

const insideKiri: Item[] = [
  { name: 'three.js', version: '0.182.0', licence: 'MIT', href: 'https://github.com/mrdoob/three.js' },
  { name: 'three-mesh-bvh', version: '0.7.6', licence: 'MIT', href: 'https://github.com/gkjohnson/three-mesh-bvh' },
  {
    name: 'JSZip',
    version: '3.10.1',
    licence: 'MIT or GPL-3.0-or-later',
    href: 'https://github.com/Stuk/jszip',
    note: 'Its browser file contains pako 1.0.11 (MIT and Zlib), lie 3.3.0, immediate 3.0.6 and setimmediate 1.0.5 (MIT).',
  },
  {
    name: 'Manifold',
    version: '3.3.2',
    licence: 'Apache-2.0',
    href: 'https://github.com/elalish/manifold',
    note: 'As manifold.wasm.',
  },
  { name: 'earcut', version: '3.0.1', licence: 'ISC', href: 'https://github.com/mapbox/earcut' },
  { name: 'base64-js', version: '1.5.1', licence: 'MIT', href: 'https://github.com/beatgammit/base64-js' },
  { name: 'tween.js', version: '16.6.0', licence: 'MIT', href: 'https://github.com/tweenjs/tween.js' },
  { name: '@tracespace/parser', version: '5.0.0-next.0', licence: 'MIT', href: 'https://github.com/tracespace/tracespace' },
  { name: '@gridspace/raster-path', version: '1.1.1', licence: 'MIT', href: 'https://github.com/gridspace/raster-path' },
  { name: 'quickjs-emscripten', version: '0.20.0', licence: 'MIT', href: 'https://github.com/justjake/quickjs-emscripten' },
  {
    name: 'Clipper',
    version: '6.4.2',
    licence: 'BSL-1.0',
    href: 'http://www.angusj.com',
    note: "A JavaScript copy inside Kiri:Moto's source, with Tom Wu's JSBN under its own BSD-style licence.",
  },
  { name: 'JSPoly', version: '1.0.1', licence: 'BSL-1.0', href: KIRI_REPO, note: "A copy inside Kiri:Moto's source." },
  { name: 'pngjs', licence: 'MIT', href: 'https://github.com/pngjs/pngjs', note: "A browser build inside Kiri:Moto's source." },
  {
    name: 'md5.js',
    licence: 'None stated',
    href: 'https://stackoverflow.com/questions/1655769/fastest-md5-implementation-in-javascript',
    note: "Inside Kiri:Moto's source, from a Stack Overflow answer. Only its Bambu file export uses it, which GKod does not call.",
  },
];

const ANYCUBIC_SLICER = 'https://github.com/ANYCUBIC-3D/AnycubicSlicerNext/blob/6103ed8b511609658d00d0538cc7f0609cdb57da/resources/profiles/Anycubic/machine';
const CURA = 'https://github.com/Ultimaker/Cura/blob/1a221ec29a86960d16a412940becc1f63534c41f/resources/definitions';

const profiles: Item[] = [
  {
    name: 'Anycubic Kobra 2 Neo',
    licence: 'AGPL-3.0',
    href: `${ANYCUBIC_SLICER}/Anycubic%20Kobra%202%20Neo%200.4%20nozzle.json`,
    note: "Start and end code from Anycubic Slicer Next. Bed 220 x 220 x 250 mm, from Anycubic's firmware source.",
  },
  {
    name: 'Anycubic Kobra 2',
    licence: 'AGPL-3.0',
    href: `${ANYCUBIC_SLICER}/Anycubic%20Kobra%202%200.4%20nozzle.json`,
    note: "Start and end code from Anycubic Slicer Next. Bed 220 x 220 x 250 mm, from Anycubic's firmware source.",
  },
  {
    name: 'Creality Ender-3 V2',
    licence: 'LGPL-3.0',
    href: `${CURA}/creality_ender3.def.json`,
    note: "Start and end code from Cura's Creality Ender-3 profile. Bed 220 x 220 x 250 mm, from Creality's firmware source.",
  },
  {
    name: 'Other printer, 220 x 220 mm, Marlin',
    licence: 'AGPL-3.0',
    href: `${ANYCUBIC_SLICER}/Anycubic%20Kobra%202%20Neo%200.4%20nozzle.json`,
    note: 'The Kobra 2 Neo code without its Anycubic-only lines. Bed 220 x 220 x 200 mm, a common size.',
  },
];

const fonts: Item[] = [
  { name: 'Archivo', licence: 'SIL Open Font License 1.1', href: 'https://github.com/Omnibus-Type/Archivo' },
  { name: 'IBM Plex Mono', licence: 'SIL Open Font License 1.1', href: 'https://github.com/IBM/plex' },
];

const section: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 12,
  marginTop: 14,
  paddingTop: 16,
  borderTop: 'var(--rule)',
};
const heading: CSSProperties = { fontSize: 24, fontWeight: 600, lineHeight: 1.15 };
const list: CSSProperties = { listStyle: 'none', padding: 0, borderBottom: 'var(--rule-soft)' };
const row: CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  alignItems: 'baseline',
  justifyContent: 'space-between',
  gap: '2px 16px',
  padding: '10px 0',
  borderTop: 'var(--rule-soft)',
};
const noteLine: CSSProperties = { flexBasis: '100%', fontSize: 15 };
const facts: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'minmax(96px, max-content) minmax(0, 1fr)',
  gap: '6px 16px',
  margin: 0,
};
const wrap: CSSProperties = { overflowWrap: 'anywhere' };
const text: CSSProperties = { maxWidth: '68ch' };

function ItemList({ items, label }: { items: Item[]; label: string }) {
  return (
    <ul style={list} aria-label={label}>
      {items.map((item) => (
        <li key={item.name} style={row}>
          <span>
            <a href={item.href}>{item.name}</a>
            {item.version && <span className="mono muted"> {item.version}</span>}
          </span>
          <span className="mono">{item.licence}</span>
          {item.note && (
            <span className="muted" style={noteLine}>
              {item.note}
            </span>
          )}
        </li>
      ))}
    </ul>
  );
}

function Fact({ term, children }: { term: string; children: ReactNode }) {
  return (
    <>
      <dt className="muted">{term}</dt>
      <dd style={{ margin: 0, ...wrap }}>{children}</dd>
    </>
  );
}

export function Notices() {
  return (
    <>
      <h1 className="display" tabIndex={-1}>
        Notices
      </h1>
      <p style={text}>
        GKod is free software under the GNU General Public License, version 3 or later. It uses that licence because
        this site ships a compiled copy of OpenSCAD, which is GPL software.
      </p>
      <p style={text}>
        <a href={GKOD_REPO}>Source code for this site</a>
        {' · '}
        <a href={`${GKOD_REPO}/blob/main/LICENSE`}>Licence text</a>
        {' · '}
        <a href={LICENCE_TEXTS}>Full licence texts of the third-party software</a>
      </p>
      <p className="muted" style={text}>
        This page lists the third-party software and fonts the site ships or loads, and where the printer profiles
        come from. The full licence texts are in one text file that ships with the site. The print checks and the
        G-code safety check are GKod's own code and add no third-party software. Last checked 26 November 2026.
      </p>

      <section style={section} aria-labelledby="notices-openscad">
        <h2 id="notices-openscad" style={heading}>
          OpenSCAD web build
        </h2>
        <p style={text}>
          The site serves two unmodified files from the official OpenSCAD WebAssembly build, openscad.js and
          openscad.wasm. They turn part code into a mesh in your browser.
        </p>
        <dl style={facts}>
          <Fact term="Version">
            <span className="mono">2026.11.23</span>
          </Fact>
          <Fact term="Licence">
            <span className="mono">GPL-2.0-or-later</span>, with an exception that allows linking with CGAL.{' '}
            <a href={`${OPENSCAD_REPO}/blob/${OPENSCAD_COMMIT}/COPYING`}>Licence file</a>
          </Fact>
          <Fact term="Exact source">
            <a href={`${OPENSCAD_REPO}/tree/${OPENSCAD_COMMIT}`}>
              openscad/openscad at commit <span className="mono">77a103b9</span>
            </a>
          </Fact>
          <Fact term="Binary from">
            <a href={OPENSCAD_ZIP} className="mono">
              files.openscad.org/snapshots/OpenSCAD-2026.11.23-WebAssembly-web.zip
            </a>
          </Fact>
        </dl>

        <h3 style={{ fontSize: 16, fontWeight: 600, marginTop: 8 }}>Libraries inside the OpenSCAD build</h3>
        <ItemList items={insideOpenscad} label="Libraries inside the OpenSCAD build" />
        <p className="muted" style={{ ...text, fontSize: 15 }}>
          The build also contains other libraries, each under its own licence, such as lib3mf, Clipper2, FreeType,
          HarfBuzz, Fontconfig, libxml2, libzip, zlib, GLib, cairo, GMP, MPFR, Boost, Eigen and double-conversion.
          Their licences have not been checked one by one here.{' '}
          <a href={`${OPENSCAD_REPO}/blob/${OPENSCAD_COMMIT}/README.md#prerequisites`}>OpenSCAD's own list</a>
        </p>
      </section>

      <section style={section} aria-labelledby="notices-kiri">
        <h2 id="notices-kiri" style={heading}>
          Kiri:Moto slicer
        </h2>
        <p style={text}>
          The site serves a build of the Kiri:Moto slicing engine, made from its source by a script in this
          repository. It turns a part into G-code in your browser. Two wasm file paths are changed so the files load
          from the site; nothing else is changed.
        </p>
        <dl style={facts}>
          <Fact term="Version">
            <span className="mono">4.7.4</span>
          </Fact>
          <Fact term="Licence">
            <span className="mono">MIT</span>, in its licence file and package.json.{' '}
            <a href={`${KIRI_REPO}/blob/${KIRI_COMMIT}/license.md`}>Licence file</a>
          </Fact>
          <Fact term="Exact source">
            <a href={`${KIRI_REPO}/tree/${KIRI_COMMIT}`}>
              GridSpace/grid-apps at commit <span className="mono">47efc37e</span>
            </a>
          </Fact>
          <Fact term="Licence texts">
            <a href={KIRI_TEXTS}>Kiri:Moto and the libraries inside it</a>
          </Fact>
        </dl>
        <p className="muted" style={{ ...text, fontSize: 15 }}>
          Its source files also carry the header &ldquo;Copyright Stewart Allen -- All Rights Reserved&rdquo;, and the
          build keeps that line. Its licence file and package.json say MIT, and its readme says it is free for use
          without restriction. GKod uses it under the MIT licence.
        </p>

        <h3 style={{ fontSize: 16, fontWeight: 600, marginTop: 8 }}>Libraries inside the Kiri:Moto build</h3>
        <ItemList items={insideKiri} label="Libraries inside the Kiri:Moto build" />
      </section>

      <section style={section} aria-labelledby="notices-printers">
        <h2 id="notices-printers" style={heading}>
          Printer profiles
        </h2>
        <p style={text}>
          Each printer's start and end code is copied from an open-source slicer profile for that printer. GKod fills
          in the PLA temperatures and adds the extruder mode and part fan lines, and checks every file before it is
          offered.
        </p>
        <ItemList items={profiles} label="Printer profiles" />
      </section>

      <section style={section} aria-labelledby="notices-packages">
        <h2 id="notices-packages" style={heading}>
          JavaScript packages
        </h2>
        <ItemList items={packages} label="JavaScript packages" />
        <p className="muted" style={{ ...text, fontSize: 15 }}>
          react-three-fiber brings these with it, and they are in the site bundle.
        </p>
        <ItemList items={withFiber} label="Packages that come with react-three-fiber" />
        <p className="muted" style={{ ...text, fontSize: 15 }}>
          It also installs @babel/runtime, buffer, base64-js and ieee754. Only its React Native build uses them, so they
          are not in the site bundle.
        </p>
      </section>

      <section style={section} aria-labelledby="notices-fonts">
        <h2 id="notices-fonts" style={heading}>
          Fonts
        </h2>
        <p style={text}>
          The font files ship with the site, so no other server is asked for them. They are the Fontsource 5.3.0
          builds of the Google Fonts versions.
        </p>
        <ItemList items={fonts} label="Fonts" />
      </section>
    </>
  );
}
