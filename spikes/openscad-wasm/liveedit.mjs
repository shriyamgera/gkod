// "Live edit": change one named parameter and recompile, two ways:
//   1. -D name=value on the command line (source text untouched; this is what sliders need)
//   2. editing the assignment in the source text
// Also exports the parameter list (name, default, comment) that a slider panel can be built from.
import { readFileSync } from 'node:fs';
import { compile } from './compile.mjs';
import { checkStl } from './meshcheck.mjs';

const here = new URL('.', import.meta.url);
const src = readFileSync(new URL('parts/phone_stand.scad', here), 'utf8');
await compile('cube(1);'); // load the WASM module once so the rows below are warm

const rows = [];
async function row(label, source, defines) {
  const t0 = performance.now();
  const r = await compile(source, { defines });
  const mesh = checkStl(r.stl);
  rows.push({ change: label, roundtrip_ms: Math.round(performance.now() - t0), ok: r.ok,
    triangles: mesh.triangles, watertight: mesh.watertight, bbox: mesh.bbox.join(' x '),
    volume_mm3: mesh.volumeMm3, warnings: r.warnings.length });
}
await row('(defaults)', src, {});
for (const width of [60, 70, 90, 100, 120]) await row(`-D width=${width}`, src, { width });
await row('-D angle=60', src, { angle: 60 });
await row('-D height=140 -D lip=20', src, { height: 140, lip: 20 });
await row('source edit: width = 95', src.replace(/^width = \d+;/m, 'width = 95;'), {});
for (const [name, source, defines] of [
  ['box: (defaults)', 'box_hole', {}],
  ['box: -D hole_d=12', 'box_hole', { hole_d: 12 }],
  ['box: -D size=[60,20,8]', 'box_hole', { size: [60, 20, 8] }],
  ['plate: -D cols=10 -D rows=4', 'plate_40_holes', { cols: 10, rows: 4 }],
]) await row(name, readFileSync(new URL(`parts/${source}.scad`, here), 'utf8'), defines);
console.table(rows);

// Parameter list for building sliders: -o params.json --export-format=param
const OpenSCAD = (await import(new URL('vendor/web/openscad.js', here))).default;
const inst = await OpenSCAD({ noInitialRun: true, print: () => {}, printErr: () => {},
  wasmBinary: readFileSync(new URL('vendor/web/openscad.wasm', here)) });
inst.FS.writeFile('/in.scad', src);
const t0 = performance.now();
try { inst.callMain(['/in.scad', '-o', '/params.json', '--export-format=param']); } catch { /* exit */ }
const params = JSON.parse(inst.FS.readFile('/params.json', { encoding: 'utf8' }));
console.log(`parameter export: ${Math.round(performance.now() - t0)} ms`);
console.table(params.parameters.map((p) => ({ name: p.name, type: p.type, initial: p.initial, caption: p.caption })));
