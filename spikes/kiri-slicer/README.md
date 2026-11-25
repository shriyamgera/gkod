# Spike: Kiri:Moto as the slicer inside our page

Day-1 feasibility test, not product code. Question: can Kiri:Moto
([GridSpace/grid-apps](https://github.com/GridSpace/grid-apps), MIT) slice a part inside our own
web page and hand the G-code back as text?

**Answer: yes, if we self-host its engine build as static files.** The hosted iframe at grid.space
cannot return G-code to a page on another domain.

Tested 25-26 Nov 2026 on a MacBook M4 (16 GB), Node 22.19, headless Chromium 156 driven by
playwright-core. Kiri:Moto source: branch `rel-4.7` (version 4.7.4 in `package.json`).

## Commands

```sh
./build-kiri.sh              # downloads the source (57 MB), installs 11 build libraries (128 MB), writes ./kiri/ (9.6 MB)
node make-stl.mjs            # writes demo/part.stl (+ .obj, .3mf) and demo/overhang.stl
npm install                  # playwright-core only (8.5 MB); uses a Chromium already in the Playwright cache
node run-headless.mjs        # 19 slices in headless Chromium -> results/results.json, G-code in out/
node run-frame-headless.mjs  # hosted-iframe test against grid.space -> results/frame-results.json
node serve.mjs               # then open http://127.0.0.1:8765/ to try the demo by hand
```

`.work/`, `node_modules/`, `out/` and `kiri/` are git-ignored. Run `./build-kiri.sh` first on a fresh clone.

## Files

| File | What it is |
|---|---|
| `build-kiri.sh`, `build-kiri.mjs` | Builds only the slicing engine with esbuild (no webpack, no Electron) |
| `make-stl.mjs` | Test part: 40 x 20 x 10 mm box with an 8 mm through-hole, 544 triangles, watertight |
| `demo/slicer.js` | Our wrapper: `sliceToGcode(bytes, settings)` returns G-code text and numbers |
| `demo/gcode-stats.js` | Reads G-code back: layers, filament, time, line segments per layer |
| `demo/index.html` | The demo page |
| `demo/frame.html` | Page that embeds the hosted app in an iframe |
| `results/` | Measured results and two screenshots |

## What was run and seen

### 1. Integration routes

| Route | Needs grid.space online | Result |
|---|---|---|
| Hosted iframe + `postMessage` ("frame" API) | yes | Commands from our page arrive and run (slice and prepare ran inside the iframe). **0 events and no G-code came back to our page.** On grid.space's own demo page (same origin) the same calls returned 4 events and 1,048,057 characters of G-code in 1.4 s. The iframe loads about 8-12 MB and shows Kiri's full UI. |
| Hosted engine module (`https://grid.space/lib/kiri/run/engine.js`) imported into our page | yes | Module imports, but the browser refuses to start its worker from another origin (`SecurityError: Failed to construct 'Worker'`). No G-code after 15 s. |
| **Self-hosted engine build** (this spike) | **no** | **Works.** Every request in the test went to 127.0.0.1 only. |
| Node command line (`src/kiri/run/cli.js`) | no | Broken in `rel-4.7`: it fails on a missing file (`src/main/gapp.js`). A server-side route would have to be a headless browser running the page, which is what the test does. |

Likely cause of the iframe result, from reading `src/kiri/app/frame.js`: replies are posted without a
target origin, so the browser only delivers them to a same-origin parent. Not confirmed with the author.

The self-hosted build is five static files:

| File | Size | Gzip |
|---|---|---|
| `kiri-eng.js` (page side) | 3.96 MB | 1.26 MB |
| `kiri-work.js` (worker) | 3.86 MB | 1.28 MB |
| `kiri-pool.js` (worker pool, 8 workers started) | 1.33 MB | 0.37 MB |
| `wasm/manifold.wasm` (requested as `../wasm/manifold.wasm`; see the re-check below, slicing also worked without it) | 0.48 MB | 0.19 MB |
| `devices.json` (printer profiles) | 0.29 MB | 0.04 MB |

Three fixes were needed to build it outside the upstream toolchain; all are in `build-kiri.mjs`:
a define for `process.env.QTS_DEBUG`, our own JSZip entry (otherwise 3MF loading fails), and a small
entry file that also exports the mesh loaders.

### 2. Demo: STL in, G-code text out

`demo/index.html` loads the part, slices it and puts the G-code in a `<textarea>`.
Base case (0.2 mm layers, 2 walls, 20 % gyroid infill, generic Marlin): 32,572 lines, 986,236 bytes,
50 layers from Z 0.2 to Z 10.0. Screenshot: `results/demo.png`.

Settings that changed the output as expected:

| Case | Total ms | G-code lines | Layers | Kiri time (s) | Filament (mm) | PLA (g) |
|---|---|---|---|---|---|---|
| base 0.2 mm, 2 walls, 20 % | 1568 | 32,572 | 50 | 1200 | 1068.8 | 3.19 |
| same again | 2563 | 32,572 | 50 | 1200 | 1068.8 | 3.19 |
| layer 0.1 mm | 4769 | 66,727 | 100 | 1989 | 876.6 | 2.61 |
| 4 walls | 2629 | 35,894 | 50 | 1510 | 1435.3 | 4.28 |
| infill 60 % | 1565 | 50,350 | 50 | 1308 | 1212.8 | 3.62 |
| infill 100 % | 1151 | 21,383 | 50 | 3149 | 3814.8 | 11.38 |
| infill 100 %, flow multipliers set to 1.0 | 685 | 21,383 | 50 | 3149 | 2523.8 | 7.53 |
| infill 80 % grid | 1217 | 106,153 | 50 | 2857 | 2904.0 | 8.66 |
| **infill 80 % gyroid** | **no result after 60 s** | | | | | |
| zone: layers 10-30 with 5 walls | 2699 | 34,425 | 50 | 1431 | 1340.4 | 4.00 |
| zone: layers 10-30 with 5 walls + 50 % infill | 2026 | 38,006 | 50 | 1460 | 1368.4 | 4.08 |
| overhang part, supports off | 2825 | 8,908 | 70 | 1275 | 519.8 | 1.55 |
| overhang part, supports on | 2435 | 10,588 | 70 | 2043 | 765.5 | 2.28 |
| Generic Klipper | 2861 | 32,572 | 50 | 1200 | 1068.8 | 3.19 |
| Bambu A1 | 2958 | 33,769 | 51 | 1200 | 1198.6 | 3.57 |
| Bambu P1S | 3050 | 33,480 | 50 | 1200 | 1108.3 | 3.31 |
| custom printer (180 mm bed, 0.6 nozzle, own start/end G-code) | 2458 | 29,965 | 50 | 1040 | 1327.3 | 3.96 |
| same part as OBJ | 2869 | 32,572 | 50 | 1200 | 1068.8 | 3.19 |
| same part as 3MF | 2782 | 32,572 | 50 | 1200 | 1068.8 | 3.19 |

"Total ms" is parse + slice + prepare + export on a fresh page each time. Across three full runs
the base case took 1.0 to 2.6 s and every finished case took 0.7 to 4.8 s. Slicing is about 90 % of it.

### 3. Print time and filament

- **Reported directly.** The export step returns `time` (seconds), `distance` (filament mm), `lines`
  and `bytes`. The G-code also ends with `; --- filament used: 1068.82 mm ---` and `; --- print time: 1200s ---`.
- **Weight** is not reported. We compute it: length x filament cross-section x density (1.75 mm, PLA 1.24 g/cm3).
- **Cross-check from the G-code text** (`gcode-stats.js`): filament 1068.73 mm against Kiri's 1068.82 mm.
  Our time with no acceleration model is 801 s against Kiri's 1200 s. Reading the exporter, Kiri's time is
  distance / feedrate times a fixed 1.5 factor, so it is a rough estimate, not a firmware-accurate one.
- **Flow needs calibration before the weight can be trusted.** The part's volume is 7,498 mm3. At 100 % infill
  the default profile extrudes 9,176 mm3 (122 %); with the three flow multipliers set to 1.0 it extrudes
  6,070 mm3 (81 %). Neither is right for a solid part.

### 4. Input formats and per-region settings

- **STL, OBJ and 3MF all sliced to the same output** (binary STL; OBJ as text; 3MF written by `make-stl.mjs`).
  The `Engine` class only takes STL; OBJ and 3MF go through Kiri's loader functions, which our build exports.
  The hosted iframe API handles STL and SVG only (OBJ and 3MF are marked "todo" in its source).
- **Per-region settings: by layer range only.** `process.ranges` overrides any process field between two
  layer numbers. Seen in the G-code: extruded path per layer went from about 410 mm to about 810 mm in
  layers 10-30 with 5 walls, and back to 397 mm at layer 31. A stronger zone that is a *box inside the part*
  (not a full-height band) is not something the engine API offers; none was found in the FDM source.
- **Supports:** `sliceSupportType: "automatic"` added material under the overhang (519.8 to 765.5 mm).
  The old `sliceSupportEnable` flag in Kiri's own CLI example does nothing in this version.

### 5. Printer profiles and layer preview

- **Bed size, nozzle, start and end G-code can all be set.** The custom case produced
  `; Bed left:0 right:180 top:180 bottom:0`, our `; SHILP-START` / `; SHILP-END` lines, and `M104 S200` /
  `M140 S60` filled in from `{temp}` / `{bed_temp}`.
- **59 FDM printer profiles ship with it**, including `Any.Generic.Marlin`, `Any.Generic.Klipper`,
  `Bambu.A1` and `Bambu.P1S`. All four produced G-code; the Bambu ones carry Bambu's long start sequence
  (`M73`, `M620`, `M621` AMS commands).
- **Not tested on a real printer.** Nothing here was printed.
- Kiri does not write `M82`/`M83` itself. The start G-code must set the extruder mode to match the profile.
- The generic profiles use an older JSON shape (`pre`, `post`, `cmd`, `settings`); `demo/slicer.js` converts it.
- **Layer preview in our own viewer: yes, no iframe needed.** `gcode-stats.js` turns the G-code into line
  segments per layer (30,987 extrusion segments for the base case); the demo draws one layer on a canvas, and
  the same arrays can feed `THREE.LineSegments`. With `setRender(true)` the engine also streams its own
  per-layer drawing data (51 messages for 50 layers), but in an internal, undocumented encoding.

### 6. Licences and project activity

| Piece we would ship | Licence |
|---|---|
| Kiri:Moto / grid-apps | MIT (`license.md`, `package.json`). Source file headers say "All Rights Reserved"; worth one question to the author. |
| three 0.182, three-mesh-bvh 0.7.6, base64-js, tween.js, @tracespace/parser, @gridspace/raster-path, quickjs-emscripten | MIT |
| jszip 3.10.1 | MIT or GPL-3.0 (we take MIT) |
| earcut 3.0.1 | ISC |
| manifold-3d 3.3.2 (wasm) | Apache-2.0 |
| Clipper 6.4.2 and JSPoly (vendored in `src/ext`) | Boost Software License 1.0 |
| `src/ext/md5.js` | Copied from a Stack Overflow answer, no licence stated |

Project activity, from the GitHub API on 25 Nov 2026: last push 24 Nov 2026 (branch `rel-next`), 19 commits on
that branch since 25 Aug 2026, latest release 4.7.3 on 16 Aug 2026, 123 open issues, 23 open pull requests,
940 stars, 229 forks, not archived. One main author.

## Only read, not run

- Kiri's full app can pack a Bambu `.3mf` print file and send to Bambu printers over the network. That code
  is in the app UI and the `mods/bambu` module, not in the engine build.
- Manual (painted) supports, belt printers, adaptive layer height, multi-extruder: present in the source, untested.

## Re-check, 26 Nov 2026

A second pass re-ran the build and the tests and added a few. Same machine. The build reproduced byte for byte
and all 19 cases gave the same line counts, layers, time and filament. On a quieter machine the 18 finished
cases took 0.35 to 1.4 s. The hosted-iframe results also reproduced (0 events, worker SecurityError).

Corrections and additions:

- **Fan is off for most of the print.** In the base G-code the only fan commands are `M106 S0` twice in layer 0
  and `M106 S255` twice in layer 47. Layers 1 to 46 print with the part fan off, although `outputFanLayer = 1`
  and `outputFanSpeed = 255`. The Bambu output shows the same pattern. The wrapper must set the fan itself
  (for example a layer-change line) until this is understood.
- **The gyroid stall is at 80 % only, not "above 60 %".** Gyroid at 65, 70, 75, 79, 81 and 90 % finished in
  0.4 to 2 s. Exactly 80 % gave no result after 180 s, on the test part and on a plain box. Linear, grid, hex,
  triangle and cubic at 80 % all finished in under 0.5 s. The timeout guard is still needed.
- **Gyroid "percent" is not density.** On the test part gyroid 75 % used 1351 mm of filament and grid 80 % used
  2904 mm. On an 80 mm sphere gyroid 20 % used 13,497 mm and grid 20 % used 33,184 mm.
- **The 1 to 3 s figure is for a thumb-sized part.** Parts made in the page and sliced with the same settings:

  | Part | Triangles | Infill | Total | G-code |
  |---|---|---|---|---|
  | box 100 x 100 x 50 mm | 12 | gyroid 20 % | 13.1 s | 1.86 M lines, 56 MB |
  | sphere 80 mm | 19,800 | gyroid 20 % | 8.7 s | 1.09 M lines, 33 MB |
  | sphere 80 mm | 19,800 | grid 20 % | 7.5 s | 0.42 M lines, 13 MB |
  | sphere 150 mm | 79,600 | gyroid 15 % | 41.1 s | 6.73 M lines, 203 MB |

  G-code of this size should go to a file download, not a textarea, and needs a progress bar.
- **`manifold.wasm` is not needed for these slices, and its path is wrong on a plain static host.** `serve.mjs`
  rewrites `/wasm/...` to `/kiri/wasm/...`. With `python3 -m http.server` (no rewrite) the request went to
  `/wasm/manifold.wasm`, returned 404 five times, and the slice still gave the same 32,572 lines. On a real
  static site either put the file at `<site>/wasm/manifold.wasm` or accept the 404s.
- **Other browsers.** Firefox 142 (Playwright build): STL, 3MF and supports gave the same output as Chromium.
  WebKit 26.0 (Playwright build, which runs like a private window): `kiri-eng.js` failed to import with
  `UnknownError`, because upstream `src/moto/opfs.js` calls `await navigator.storage?.getDirectory()` when the
  module loads. With that one call stubbed on the page before the import, WebKit produced the same 32,572
  lines in 0.9 s. A normal (non-private) Safari window was not tested.
- **The build is not pinned.** `build-kiri.sh` downloads the tip of branch `rel-4.7` (commit `47efc37` on
  26 Nov 2026). Pin the commit before relying on it.
- The bundles keep the upstream notice "Copyright (C) Stewart Allen - All Rights Reserved" next to the MIT
  licence file, and they use `eval`, so a strict Content-Security-Policy would block them.

## Recommendation

1. **Self-host the engine build** (`kiri/` as static files, MIT). It works offline, costs about 3.1 MB gzipped
   on first use, and slices the test part in 1 to 3 seconds in the visitor's browser.
2. **Do not use the grid.space iframe.** It cannot return G-code to our domain and it shows Kiri's whole UI.
3. **Draw the layer preview ourselves** from the G-code in three.js.
4. **Guard it:** run each slice with a timeout and restart the worker if it stalls (gyroid at exactly 80 % never
   finished; see the re-check below); calibrate the flow multipliers before showing grams.
5. **Zones:** offer "stronger between these heights". A stronger box inside the part needs a different slicer.

**Fallback if Kiri:Moto is not good enough:** keep the page the same and swap what is behind
`sliceToGcode()`. The exact-numbers option is OrcaSlicer or PrusaSlicer run from the command line on the
owner's machine, which also gives modifier volumes (true per-region strength) and accurate print time.
Both are AGPL-3.0, so they stay as a separate local tool and are not bundled into the site.
