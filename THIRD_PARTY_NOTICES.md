# Third-party notices

GKod is free software under the GNU General Public License, version 3 or later. The full text is in [LICENSE](LICENSE).

GKod uses version 3 or later because the site ships a compiled copy of OpenSCAD, which is GPL software.

This file lists the third-party software and fonts that the site ships to the browser or loads there, and where the printer profiles come from. It is checked against each project's own licence file. **The list grows as pieces are added.** The print checks and the G-code safety check are GKod's own code and add no third-party software.

Last checked: 26 November 2026.

The full licence texts of everything below that the site ships are in [app/public/third-party-licenses.txt](app/public/third-party-licenses.txt). The site serves that file next to its pages, and the Notices page links to it. `npm run licenses` rebuilds it. The libraries inside the slicer build have their full texts in `kiri/LICENSES.txt`, which `scripts/fetch-kiri.sh` writes next to that build.

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

## Kiri:Moto slicing engine

The site serves a build of the Kiri:Moto slicing engine in `kiri/`: `kiri-eng.js`, `kiri-work.js`, `kiri-pool.js`, `wasm/manifold.wasm` and `wasm/kiri-geo.wasm`. It turns a part into G-code in the browser. The files are not stored in this repository: `scripts/fetch-kiri.sh` downloads the source at a pinned commit, checks its sha256, and builds only the engine with esbuild (the libraries it bundles are pinned in `scripts/kiri/package-lock.json`).

| | |
|---|---|
| Version | 4.7.4 (`package.json` at the commit below) |
| Licence | MIT: [license.md](https://github.com/GridSpace/grid-apps/blob/47efc37eca9a387dfdcd2990273fae6b9680cb64/license.md), and `"license": "MIT"` in [package.json](https://github.com/GridSpace/grid-apps/blob/47efc37eca9a387dfdcd2990273fae6b9680cb64/package.json) |
| Exact source | commit [`47efc37e`](https://github.com/GridSpace/grid-apps/tree/47efc37eca9a387dfdcd2990273fae6b9680cb64) of [github.com/GridSpace/grid-apps](https://github.com/GridSpace/grid-apps), the tip of branch `rel-4.7` on 26 November 2026 |
| Source downloaded from | <https://codeload.github.com/GridSpace/grid-apps/tar.gz/47efc37eca9a387dfdcd2990273fae6b9680cb64> |
| sha256 of the source | `23a0fd92804b57a9ef4abdf297fe39733d106d56d65636b12a6ef8a3283a84db` |
| Changes | Two wasm file paths are made relative to the bundle, so the files load from `kiri/`. Our own entry file exports the engine and its worker client. Nothing else is changed. |

**"All Rights Reserved" headers.** Kiri:Moto's source files carry the header "Copyright Stewart Allen <sa@grid.space> -- All Rights Reserved", and the bundles keep the string "Copyright (C) Stewart Allen <sa@grid.space> - All Rights Reserved" from `src/moto/license.js`, which points to the licence file. The licence file and `package.json` say MIT, and the project's readme says Kiri:Moto is "completely open source and free for use without restriction". We use it under the MIT licence. The author has not been asked about the headers.

### Libraries inside the Kiri:Moto build

These are bundled into the three Kiri:Moto files by the build. The list is made from esbuild's record of what each bundle contains.

| Library | Version | Licence | Source |
|---|---|---|---|
| three.js | 0.182.0 | MIT | [github.com/mrdoob/three.js](https://github.com/mrdoob/three.js) |
| three-mesh-bvh | 0.7.6 | MIT | [github.com/gkjohnson/three-mesh-bvh](https://github.com/gkjohnson/three-mesh-bvh) |
| JSZip | 3.10.1 | MIT or GPL-3.0-or-later | [github.com/Stuk/jszip](https://github.com/Stuk/jszip) |
| pako, lie, immediate, setimmediate (inside JSZip's browser file) | 1.0.11, 3.3.0, 3.0.6, 1.0.5 | MIT and Zlib (pako), MIT | [github.com/nodeca/pako](https://github.com/nodeca/pako) |
| Manifold (`manifold-3d`, as `manifold.wasm`) | 3.3.2 | Apache-2.0 | [github.com/elalish/manifold](https://github.com/elalish/manifold) |
| earcut | 3.0.1 | ISC | [github.com/mapbox/earcut](https://github.com/mapbox/earcut) |
| base64-js | 1.5.1 | MIT | [github.com/beatgammit/base64-js](https://github.com/beatgammit/base64-js) |
| tween.js (`@tweenjs/tween.js`) | 16.6.0 | MIT | [github.com/tweenjs/tween.js](https://github.com/tweenjs/tween.js) |
| `@tracespace/parser` | 5.0.0-next.0 | MIT | [github.com/tracespace/tracespace](https://github.com/tracespace/tracespace) |
| `@gridspace/raster-path` | 1.1.1 | MIT | [github.com/gridspace/raster-path](https://github.com/gridspace/raster-path) |
| quickjs-emscripten | 0.20.0 | MIT | [github.com/justjake/quickjs-emscripten](https://github.com/justjake/quickjs-emscripten) |

Files copied into the grid-apps source (`src/ext`) and bundled with it:

| File | Licence |
|---|---|
| Clipper 6.4.2, JavaScript translation (`clip2.js`), with Tom Wu's JSBN | Boost Software License 1.0; JSBN under its own BSD-style licence |
| JSPoly 1.0.1 (`jspoly.js`), with JSBN | Boost Software License 1.0 |
| pngjs browser build (`pngjs.js`) | MIT |
| `md5.js` | No licence stated. Its only line of origin is a link to a Stack Overflow answer. It is used by Kiri:Moto's Bambu file export, which GKod does not call. |

## Printer profiles

The bed sizes come from each maker's own firmware source. The start and end G-code of each printer is copied from an open-source slicer profile for that printer; only the temperatures (PLA, nozzle 205 °C, bed 60 °C) are filled in by GKod. The extruder mode line and the part fan lines in the sliced part are GKod's own. Every G-code file is checked by GKod's safety check before it is offered.

| Printer | Bed (mm) | Bed size from | Start and end code from | Licence of that code |
|---|---|---|---|---|
| Anycubic Kobra 2 Neo | 220 x 220 x 250 | [Kobra2_Neo firmware, Configuration.h](https://github.com/ANYCUBIC-3D/Kobra2_Neo/blob/972d34e4173e14be2d81b9e6d35e9bc9b372be5f/Marlin/Configuration.h) (Anycubic) | [Anycubic Slicer Next, "Anycubic Kobra 2 Neo 0.4 nozzle"](https://github.com/ANYCUBIC-3D/AnycubicSlicerNext/blob/6103ed8b511609658d00d0538cc7f0609cdb57da/resources/profiles/Anycubic/machine/Anycubic%20Kobra%202%20Neo%200.4%20nozzle.json) (Anycubic); the same text is in [OrcaSlicer](https://github.com/OrcaSlicer/OrcaSlicer/blob/d42123d2f116dd253cb9c4967d9a564713b85a22/resources/profiles/Anycubic/machine/Anycubic%20Kobra%202%20Neo%200.4%20nozzle.json) | AGPL-3.0 |
| Anycubic Kobra 2 | 220 x 220 x 250 | [Kobra2 firmware, Configuration.h](https://github.com/ANYCUBIC-3D/Kobra2/blob/ff6e73c8cff5ece6212a2eac38a7d2089ef0c3fd/source/Marlin/Configuration.h) (Anycubic) | [Anycubic Slicer Next, "Anycubic Kobra 2 0.4 nozzle"](https://github.com/ANYCUBIC-3D/AnycubicSlicerNext/blob/6103ed8b511609658d00d0538cc7f0609cdb57da/resources/profiles/Anycubic/machine/Anycubic%20Kobra%202%200.4%20nozzle.json) | AGPL-3.0 |
| Creality Ender-3 V2 | 220 x 220 x 250 | [Ender-3V2 firmware, Configuration.h](https://github.com/CrealityOfficial/Ender-3V2/blob/88a603b396d09607f4b25bf1bd1c5881092380c0/Marlin/Configuration.h) (Creality) | Cura's ["Creality Ender-3 / Ender-3 v2"](https://github.com/Ultimaker/Cura/blob/1a221ec29a86960d16a412940becc1f63534c41f/resources/definitions/creality_ender3.def.json), with the end code of [creality_base](https://github.com/Ultimaker/Cura/blob/1a221ec29a86960d16a412940becc1f63534c41f/resources/definitions/creality_base.def.json); the heating and M82 lines that Cura writes itself are written out | LGPL-3.0 |
| Creality Ender-3 S1 Plus | 300 x 300 x 300 | [Ender-3S1 firmware, branch s1_pro_plus, Configuration.h](https://github.com/CrealityOfficial/Ender-3S1/blob/7fffa9270ff8fb5ee208a5b04f832e20bab19c60/Marlin/Configuration.h), the `ENDER_3S1_PLUS` block (Creality) | Cura's ["Creality Ender-3 S1 Plus"](https://github.com/Ultimaker/Cura/blob/1a221ec29a86960d16a412940becc1f63534c41f/resources/definitions/creality_ender3s1plus.def.json), with the end code of [creality_base](https://github.com/Ultimaker/Cura/blob/1a221ec29a86960d16a412940becc1f63534c41f/resources/definitions/creality_base.def.json); the M82 line that Cura writes itself is written out | LGPL-3.0 |
| Other printer, 220 x 220 mm, Marlin | 220 x 220 x 200 | A common bed size, not a spec; the height is kept low on purpose | The Kobra 2 Neo code without its Anycubic-only lines (M420 levelling, M300 beeps) | AGPL-3.0 |

Anycubic's product page for the Kobra 2 Neo refused automated reading (HTTP 429), so its size was taken from Anycubic's firmware source and Anycubic's own slicer profile instead; both say 220 x 220 x 250 mm. Kiri:Moto's own profiles for the Kobra (222 mm) and Kobra 2 (200 mm) do not match these and are not used.

Not offered: Bambu Lab A1 and P1S, and Prusa MK4. Their makers' start code moves outside the printable bed (the A1 wipes at X -48 mm, the MK4 purges at Y -4 mm) and the Bambu code saves settings with M500, which GKod's safety check refuses. The Creality Ender-3 S1 Plus is offered as the larger bed instead.

## JavaScript packages in the site bundle

| Package | Version | Licence | Source |
|---|---|---|---|
| React (`react`, `react-dom`) | 19.3.1 | MIT | [github.com/react/react](https://github.com/react/react) |
| scheduler (part of React) | 0.28.0 | MIT | [github.com/react/react](https://github.com/react/react) |
| three.js, with its OrbitControls add-on | 0.187.0 | MIT | [github.com/mrdoob/three.js](https://github.com/mrdoob/three.js) |
| react-three-fiber (`@react-three/fiber`) | 9.8.2 | MIT | [github.com/pmndrs/react-three-fiber](https://github.com/pmndrs/react-three-fiber) |

react-three-fiber brings these with it, and they are in the bundle.

| Package | Version | Licence | Source |
|---|---|---|---|
| react-reconciler (part of React), copied inside react-three-fiber's own files | built from React 19.3.0 | MIT | [github.com/react/react](https://github.com/react/react) |
| zustand | 5.1.0 | MIT | [github.com/pmndrs/zustand](https://github.com/pmndrs/zustand) |
| its-fine | 2.1.1 | MIT | [github.com/pmndrs/its-fine](https://github.com/pmndrs/its-fine) |
| react-use-measure | 2.1.7 | MIT | [github.com/pmndrs/react-use-measure](https://github.com/pmndrs/react-use-measure) |
| suspend-react | 0.1.3 | MIT | [github.com/pmndrs/suspend-react](https://github.com/pmndrs/suspend-react) |
| use-sync-external-store (part of React) | 1.7.0 | MIT | [github.com/react/react](https://github.com/react/react) |

react-three-fiber also installs `@babel/runtime`, `buffer`, `base64-js` and `ieee754`. Only its React Native build uses them, so they are not in the site bundle.

Versions are the ones in `package-lock.json` on the date above.

## Fonts

The font files ship with the site, so a page load asks no other server for them. They are in `app/src/styles/fonts`, with each font's licence text beside them. The files are the Latin and Latin Extended subsets from the Fontsource packages `@fontsource-variable/archivo` 5.3.0 and `@fontsource/ibm-plex-mono` 5.3.0, which are built from the Google Fonts versions.

| Font | Licence | Source |
|---|---|---|
| Archivo | SIL Open Font License 1.1 | [github.com/Omnibus-Type/Archivo](https://github.com/Omnibus-Type/Archivo) |
| IBM Plex Mono | SIL Open Font License 1.1 | [github.com/IBM/plex](https://github.com/IBM/plex) |

## Build tools

Vite, TypeScript, Vitest and Playwright are used to build and test the site, and esbuild builds the Kiri:Moto engine. They are not shipped to the browser, so they are not listed here.
