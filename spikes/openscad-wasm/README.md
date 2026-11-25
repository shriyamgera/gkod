# Spike: OpenSCAD compiled to WebAssembly

Day-1 feasibility test. Question: can OpenSCAD code be compiled to a printable mesh without the
desktop app, fast enough for live editing in a browser and for generating tens of thousands of
training parts offline?

**Answer: yes.** The official OpenSCAD nightly WebAssembly build (Manifold backend) compiles the
test parts in 9 to 90 ms once loaded, runs unchanged in Node 22 and in a browser Web Worker, needs
no special headers, and reports errors through the exit code and log lines.

Machine: MacBook M4 (10 cores, 16 GB), macOS, Node v22.19.0. Tested 25 Nov 2026.

## What is in this folder

| File | Purpose |
|---|---|
| `fetch.sh` | downloads the official WASM builds into `vendor/` (git-ignored), checks sha256 |
| `compile.mjs` | `compile(source, {defines})` -> binary STL, log, exit code, timings |
| `meshcheck.mjs` | binary-STL checker: triangles, open / non-manifold / flipped edges, volume, bbox |
| `parts/*.scad` | the three test parts plus `broken.scad` and `warning.scad` |
| `bench.mjs`, `one.mjs` | timings (warm in one process; one compile in a fresh process) |
| `liveedit.mjs` | change one parameter with `-D` and recompile; export the parameter list |
| `errors.mjs` | how errors and warnings come back |
| `reuse.mjs` | shows one WASM instance cannot be reused for a second compile |
| `templates.mjs`, `throughput.mjs` | program-made parts (templates + seeded random sizes) compiled in N worker threads |
| `native_bench.mjs` | same measurements with a native OpenSCAD binary |
| `browser/` | Web Worker test page, static server, headless runner |

## Commands

```sh
./fetch.sh                      # 13 MB download (3 zips), verified against the published sha256
node version.mjs                # version and build info
node bench.mjs web              # three parts, first + warm, mesh check
node one.mjs parts/phone_stand.scad manifold -D width=100   # one compile, fresh process
node one.mjs parts/plate_40_holes.scad cgal                 # old backend, for comparison
node liveedit.mjs               # -D overrides and parameter export
node errors.mjs                 # error and warning reporting
node reuse.mjs
node throughput.mjs 8 12 mix    # workers, seconds, template (mix|simple|plate|rounded|bracket)
npm install && node browser/run_headless.mjs    # needs Google Chrome installed
node native_bench.mjs /path/to/OpenSCAD.app/Contents/MacOS/OpenSCAD 8 12
```

## 1. Where to get OpenSCAD as WebAssembly

| Source | State (checked 25 Nov 2026) |
|---|---|
| **Official nightly snapshots**, `https://files.openscad.org/snapshots/OpenSCAD-<date>-WebAssembly-{web,node,node-module}.zip` | Built almost daily (20, 21 and 23 Nov 2026 present). **This is what was tested.** |
| `openscad/openscad-playground` (the official web playground) | Active (last push 25 Nov 2026). Its build downloads the prebuilt "web" WASM binary; README says it defaults to Manifold. |
| `openscad/openscad-wasm` (GitHub) | Build scripts; last push Aug 2026. Its GitHub releases stop at 2022.03.20, so do not use those. |
| npm `openscad-wasm` 0.0.4 | Last published Jul 2025, 13.9 MB unpacked, GPL-2.0. Not tested. |
| npm `openscad-wasm-prebuilt` 1.2.0 | Third-party, last published Jan 2025, 11.1 MB unpacked. Not tested. |

Tested build, from `node version.mjs`:

- OpenSCAD **2026.11.23** (git 77a103b9), Emscripten 4.0.10, wasm32, single-threaded
- **Manifold 3.5.4**, and `--backend` help text says Manifold is the default; CGAL 6.0.1 is also inside
- Export formats listed by `--help`: stl, off, wrl, 3mf, csg, dxf, svg, pdf, png, echo, ast, term, nef3, nefdbg, param, pov

Download size, measured:

| Zip | Zip size | Contents |
|---|---|---|
| web | 3.36 MB | `openscad.js` 100 kB (23.7 kB gzip) + `openscad.wasm` 11.04 MB (3.34 MB gzip) |
| node-module | 4.73 MB | one `openscad.js`, 14.8 MB, wasm embedded |
| node | 4.73 MB | one `openscad.js`, 14.8 MB, CLI style with `#!/usr/bin/env node` |

So a site visitor downloads about **3.4 MB** once (with gzip on the host).

Licence: OpenSCAD is **GPL-2.0-or-later** (with a linking exception for CGAL). A site that ships
`openscad.wasm` distributes a GPL binary: it must say so and link to the OpenSCAD source. Our own
site code is a separate program that loads it in a worker; this is the same arrangement the
official playground uses. Not legal advice.

No fonts or libraries (MCAD, BOSL2) are in the zip; `text()` needs a font file written to `/fonts`
first (not tested here).

## 2. Three parts in Node 22

"web" build loaded in Node (in-memory filesystem). Fresh WASM instance per compile.
Numbers from a quiet machine; later runs, with other heavy jobs on the machine, were 2 to 2.5x slower.

| Part | Fresh process, total | Warm, per compile | Triangles | STL | Watertight | Check |
|---|---|---|---|---|---|---|
| `box_hole` | 60 ms in-process (80 ms wall with Node start) | **9 ms** | 208 | 10 kB | yes | volume 13798.5 mm3, genus 1 |
| `phone_stand` (hull + minkowski) | 1.15 s (1.19 s wall) | **1.34 s**, or **83 ms**, see below | 1788 | 87 kB | yes | bbox 80 x 107 x 110 |
| `plate_40_holes` | 145 ms (0.16 s wall) | **56 ms** | 5292 | 258 kB | yes | Euler -78 = 40 through holes |

- Cold cost is loading and compiling the 11 MB wasm: about **33 ms** in Node. A new instance after that is **5 ms**.
- Watertight means: every edge is used by exactly two triangles, in opposite directions, no
  degenerate triangles (`meshcheck.mjs`). All three parts pass with 0 open and 0 non-manifold edges.
- Old CGAL backend, same parts: 88 ms, 1.42 s, **8.24 s**. Manifold is about 90x faster on the 40-hole plate.

**Minkowski finding.** The phone stand with default values logs
`WARNING: [manifold] Minkowski failed with error, falling back to Nef operation: CGAL ERROR: assertion violation!`
and takes 1.1 to 1.3 s. The result is still correct and watertight. The trigger is fragile:
`-D width=60/70/75/85/90/120`, `-D angle=60` and even `-D unused=1` compile in about 83 ms with no
warning, while `-D width=81`, `-D width=100` and `-D thickness=6` hit the slow path. Triangle
counts differ slightly between the two paths (1766 vs 1788). The native macOS build of the same
version compiled the default phone stand in 63 ms with no warning, so this is specific to the WASM
build. A simple `minkowski(){cube; sphere}` took 35 ms; the same rounding done with `hull()` of
eight spheres took 50 ms. **Prefer `hull()` over `minkowski()` in generated code.**

## 3. Live edit: change one parameter and recompile

`-D name=value` works; the source text is not touched. From `node liveedit.mjs` (warm, quiet machine):

| Change | Round trip | Result |
|---|---|---|
| phone stand `-D width=60` / `70` / `90` / `120` | 62 to 68 ms | bbox x = 60 / 70 / 90 / 120 |
| phone stand `-D width=100` | 1454 ms | correct, slow minkowski path |
| phone stand `-D angle=60` | 62 ms | bbox 80 x 99.5 x 101.3 |
| phone stand `-D height=140 -D lip=20` | 63 ms | two overrides at once |
| phone stand, source text edited to `width = 95` | 63 ms | same speed as `-D` |
| box `-D hole_d=12` | 9 ms | volume 13798 -> 13047 mm3 |
| box `-D size=[60,20,8]` | 8 ms | vectors work |
| plate `-D cols=10 -D rows=4` | 64 ms | bbox 124 x 52 x 4 |

So sliders work without editing code. Also measured: `-o params.json --export-format=param` returns
the list of top-level parameters (name, type, initial value) in **3 ms**; for the phone stand it
returned width, depth, height, thickness, angle, lip, round_r, slot_w and $fn. That list can build
the slider panel automatically.

One instance cannot be reused: a second `callMain` throws `program has already aborted!`
(`node reuse.mjs`). Create a new instance per compile (5 ms) and keep the compiled
`WebAssembly.Module`.

## 4. Browser Web Worker

Ran in headless Chrome 158 (`node browser/run_headless.mjs`), module worker, `browser/worker.js`.

Files to serve: `openscad.js` (100 kB), `openscad.wasm` (11 MB; serve as `application/wasm` so it
can stream-compile), and our own worker script.

**No COOP/COEP headers are needed.** The test server sends none; the page reported
`crossOriginIsolated: false` and `SharedArrayBuffer` undefined, and every compile worked. The build
has no threads. So plain static hosting (for example GitHub Pages) is enough.

Measured in the worker (machine was busy with other jobs during this run; Node on the same busy
machine gave 19 ms / 148 ms for box / plate, so browser and Node speeds are about the same):

| Step | Time |
|---|---|
| first compile, including wasm fetch from localhost + compile | 118 ms (wasm load part: 29 ms) |
| box, warm | 15 ms |
| phone stand `-D width=90` / `120` | 109 / 100 ms |
| phone stand, default values (slow minkowski path) | 2.6 s |
| plate with 40 holes | 106 ms |
| `broken.scad` | 9 ms, exit code 1, error line returned |

The STL comes back to the page as a transferred `ArrayBuffer`. Not tested: Safari, Firefox, phones,
and real network download time for the 3.4 MB.

## 5. Errors and warnings

Everything OpenSCAD prints arrives line by line in the `print` / `printErr` callbacks, and
`callMain` returns the exit code. Real output from `node errors.mjs`:

```
=== syntax error (parts/broken.scad)          exitCode=1, no STL, 40 ms
ERROR: Parser error: syntax error in file /in.scad, line 3
Can't parse file '/in.scad'!

=== warnings only (parts/warning.scad)        exitCode=0, STL written (684 bytes)
WARNING: Ignoring unknown variable "undefined_width" in file /in.scad, line 2
WARNING: Unable to convert cube(size=[10, undef, 10], ...) parameter to a number or a vec3 of numbers in file /in.scad, line 2
WARNING: Ignoring unknown module 'no_such_module' in file /in.scad, line 3

=== same file with --hardwarnings             exitCode=1, no STL
WARNING: Ignoring unknown variable "undefined_width" in file /in.scad, line 2
TRACE: called by 'cube' in file /in.scad, line 2

=== empty geometry                            exitCode=1    Current top level object is empty.
=== 2D only, STL asked                        exitCode=1    Current top level object is not a 3D object.
=== assert fails                              exitCode=1
ERROR: Assertion '(w > 0)' failed: "width must be positive" in file /in.scad, line 1
=== runaway recursion                         JavaScript exception: Maximum call stack size exceeded
```

For the training signal "compiles or not":

- pass = exit code 0 **and** an STL exists **and** the mesh check passes.
- Use `--hardwarnings`. Without it, `warning.scad` "succeeds" but silently produces a 10 x 1 x 1 mm bar
  (the undefined size falls back to 1), which is the wrong part.
- The `[manifold] Minkowski failed ... falling back` warning does not stop the compile even with
  `--hardwarnings` (tested: exit code 0, watertight STL). It only means "slow path".
- Error lines carry the line number, which is useful feedback.
- `callMain` can throw a JavaScript exception (stack overflow); catch it. An endless loop was not
  tested; run compiles in a worker with a timeout and terminate it.

## 6. Offline data generation

`node throughput.mjs <workers> <seconds> mix`: each worker thread compiles program-made parts
(four templates in `templates.mjs`, sizes from a seeded random generator, about 1040 triangles on
average) with `--hardwarnings`, then runs the mesh check.

Quiet machine:

| Workers | Compiles per minute | Peak memory (whole process) |
|---|---|---|
| 1 | 2,684 | 282 MB |
| 2 | 4,657 | 355 MB |
| 4 | 7,548 | 519 MB |
| 6 | 9,120 | 536 MB |
| 8 | **10,574** | 696 MB |
| 10 | 10,600 | 868 MB |

Per template at 8 workers: simple box 33,117/min, plate with holes 8,498/min, bracket 9,699/min,
hull-rounded shell 3,853/min. All compiled. About 1 part in 2,000 compiled with exit code 0 but
failed the watertight check: a bracket whose random sizes made neighbouring holes exactly touch
(`a=30; t=6; d=6; n=3`, hole spacing = hole diameter), giving 4 edges shared by four triangles.
`SHOW_BAD=1 node throughput.mjs 6 75 mix` prints it. So "compiles" is not enough as a label; the
mesh check must stay in the pipeline.

Later the machine was busy with other heavy jobs and the same command gave only 2,900 to 4,300 per
minute at 8 workers and 1,200 to 1,400 at 1 worker. Plan with the low figure: **50,000 parts take
about 5 minutes on a quiet machine and under 20 minutes on a busy one.** Compile time is not the bottleneck.

### Is native OpenSCAD worth installing?

Checked, not installed. The nightly disk image was downloaded, verified, mounted read-only, run
from the mount, then deleted.

- Homebrew `openscad` cask is still the 2021.01 release (no Manifold). `openscad@snapshot` cask is 2026.10.11.
- Nightly `OpenSCAD-2026.11.23.dmg`: **74 MB download, 178 MB app**, universal (arm64 + x86_64), notarized, Manifold 3.5.4, with mimalloc.
- Speed, one process per part (busy machine, same minutes as the WASM figures beside it):

| | Native | WASM in Node |
|---|---|---|
| box, one compile | 35 ms | 19 to 23 ms warm |
| phone stand, default | 63 ms (no fallback) | 1.1 to 3 s (fallback path) |
| plate with 40 holes | 62 to 110 ms | 107 to 168 ms |
| plate with 40 holes, CGAL backend | 9.1 s | 8.2 s (quiet machine) |
| throughput, 1 worker | 788 / min | 1,212 to 1,361 / min |
| throughput, 8 workers | 2,511 and 2,515 / min | 3,427 to 3,473 / min |

Native pays about 35 ms of process start per part; WASM pays 5 ms for a new instance. For small
parts the WASM build in Node was about 1.4x faster in total throughput. Native is only better for
heavy single parts and it does not hit the minkowski fallback.

## Recommendation

**(a) In-browser compiler:** the official nightly "web" build (`openscad.js` + `openscad.wasm`),
pinned to one dated snapshot and copied into the site, loaded in a module Web Worker as in
`browser/worker.js`. Compile the wasm once, new instance per compile, pass slider values with `-D`,
build the slider list with `--export-format=param`, kill the worker on a timeout.

**(b) Offline data generator:** the same WASM build in Node worker threads (`throughput.mjs`
pattern), 6 to 8 workers, `--hardwarnings`, plus the mesh check. The training label and the site
then use the exact same compiler, and nothing needs installing. Native OpenSCAD is not needed;
keep it as an optional cross-check.

## Not tested

- The `node` and `node-module` zips as a command-line tool. They use the real filesystem and write
  the log straight to the terminal, and the `node-module` build ended the Node process when
  `main()` returned in our test, so the "web" build is used in Node as well.
- `text()` and fonts, `import()` of STL/SVG files, library includes (BOSL2, MCAD), 3MF export.
- Safari, Firefox, mobile browsers, low-memory devices.
- Parts much heavier than these (hundreds of thousands of triangles) and the 4 GB wasm32 memory limit.
