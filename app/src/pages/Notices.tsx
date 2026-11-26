import type { CSSProperties, ReactNode } from 'react';

const OPENSCAD_COMMIT = '77a103b912c69e86f6b1217bd68500d2926ed1b2';
const OPENSCAD_REPO = 'https://github.com/openscad/openscad';
const OPENSCAD_ZIP = 'https://files.openscad.org/snapshots/OpenSCAD-2026.11.23-WebAssembly-web.zip';
const GKOD_REPO = 'https://github.com/shriyamgera/gkod';

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
      </p>
      <p className="muted" style={text}>
        This page lists the third-party software and fonts the site ships or loads. The list grows as pieces are
        added: the print checks and the slicer are not in the site yet. Last checked 26 November 2026.
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
          Their licences have
          not been checked one by one here.{' '}
          <a href={`${OPENSCAD_REPO}/blob/${OPENSCAD_COMMIT}/README.md#prerequisites`}>OpenSCAD's own list</a>
        </p>
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
          The fonts load from Google Fonts when the page opens. They are not copied into the site files.
        </p>
        <ItemList items={fonts} label="Fonts" />
      </section>
    </>
  );
}
