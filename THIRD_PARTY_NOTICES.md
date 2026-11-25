# Third-party notices

GKod is free software under the GNU General Public License, version 3 or later. The full text is in [LICENSE](LICENSE).

GKod uses version 3 or later because the site ships a compiled copy of OpenSCAD, which is GPL software.

This file lists the third-party software and fonts that the site ships to the browser or loads there. It is checked against each project's own licence file. **The list grows as pieces are added**: the print checks and the slicer are not in the site yet.

Last checked: 26 November 2026.

## OpenSCAD web build

The site serves two unmodified files from the official OpenSCAD WebAssembly build: `openscad.js` and `openscad.wasm`. They compile part code to a mesh in the browser. They are not stored in this repository; `scripts/fetch-openscad.sh` downloads them and checks the sha256.

| | |
|---|---|
| Version | 2026.11.23 |
| Licence | GPL-2.0-or-later, with an exception that allows linking with CGAL ([COPYING](https://github.com/openscad/openscad/blob/77a103b912c69e86f6b1217bd68500d2926ed1b2/COPYING)) |
| Exact source | commit [`77a103b9`](https://github.com/openscad/openscad/tree/77a103b912c69e86f6b1217bd68500d2926ed1b2) of [github.com/openscad/openscad](https://github.com/openscad/openscad) |
| Binary downloaded from | <https://files.openscad.org/snapshots/OpenSCAD-2026.11.23-WebAssembly-web.zip> |
| sha256 of the zip | `198d08ef3a1c064fcc208df523af1f5461b35f3f87b91f5a671704803deaf09d` |

### Libraries inside the OpenSCAD build

These are compiled into `openscad.wasm` by the OpenSCAD project.

| Library | Version | Licence | Source |
|---|---|---|---|
| Manifold | 3.5.4 | Apache-2.0 | [github.com/elalish/manifold](https://github.com/elalish/manifold) |
| CGAL | 6.0.1 | Mixed, set per file: GPL-3.0-or-later or LGPL-3.0-or-later. The parts OpenSCAD uses for solid geometry (Nef polyhedra, 3D Minkowski sums) are GPL-3.0-or-later. | [github.com/CGAL/cgal](https://github.com/CGAL/cgal), [licence notes](https://github.com/CGAL/cgal/blob/v6.0.1/Installation/LICENSE) |

The build also contains other libraries, each under its own licence. Names found in the binary include lib3mf, Clipper2, FreeType, HarfBuzz, Fontconfig, libxml2, libzip, zlib, GLib and cairo, and OpenSCAD's build instructions also list GMP, MPFR, Boost, Eigen and double-conversion. Their versions and licences have not been checked one by one here. OpenSCAD's own list is in its [README](https://github.com/openscad/openscad/blob/77a103b912c69e86f6b1217bd68500d2926ed1b2/README.md#prerequisites).

## JavaScript packages in the site bundle

| Package | Version | Licence | Source |
|---|---|---|---|
| React (`react`, `react-dom`) | 19.3.1 | MIT | [github.com/react/react](https://github.com/react/react) |
| scheduler (part of React) | 0.28.0 | MIT | [github.com/react/react](https://github.com/react/react) |
| three.js | 0.187.0 | MIT | [github.com/mrdoob/three.js](https://github.com/mrdoob/three.js) |
| react-three-fiber (`@react-three/fiber`) | 9.8.2 | MIT | [github.com/pmndrs/react-three-fiber](https://github.com/pmndrs/react-three-fiber) |

react-three-fiber brings these packages with it. Some or all of them end up in the bundle.

| Package | Version | Licence | Source |
|---|---|---|---|
| zustand | 5.1.0 | MIT | [github.com/pmndrs/zustand](https://github.com/pmndrs/zustand) |
| its-fine | 2.1.1 | MIT | [github.com/pmndrs/its-fine](https://github.com/pmndrs/its-fine) |
| react-use-measure | 2.1.7 | MIT | [github.com/pmndrs/react-use-measure](https://github.com/pmndrs/react-use-measure) |
| suspend-react | 0.1.3 | MIT | [github.com/pmndrs/suspend-react](https://github.com/pmndrs/suspend-react) |
| use-sync-external-store (part of React) | 1.7.0 | MIT | [github.com/react/react](https://github.com/react/react) |
| @babel/runtime | 7.29.15 | MIT | [github.com/babel/babel](https://github.com/babel/babel) |
| buffer | 6.0.3 | MIT | [github.com/feross/buffer](https://github.com/feross/buffer) |
| base64-js | 1.5.1 | MIT | [github.com/beatgammit/base64-js](https://github.com/beatgammit/base64-js) |
| ieee754 | 1.2.1 | BSD-3-Clause | [github.com/feross/ieee754](https://github.com/feross/ieee754) |

Versions are the ones in `package-lock.json` on the date above.

## Fonts

The fonts are loaded from Google Fonts when the page opens. They are not copied into this repository or into the site files.

| Font | Licence | Source |
|---|---|---|
| Archivo | SIL Open Font License 1.1 | [github.com/Omnibus-Type/Archivo](https://github.com/Omnibus-Type/Archivo) |
| IBM Plex Mono | SIL Open Font License 1.1 | [github.com/IBM/plex](https://github.com/IBM/plex) |

## Build tools

Vite, TypeScript and Vitest are used to build and test the site. They are not shipped to the browser, so they are not listed here.
