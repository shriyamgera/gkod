// How compile errors and warnings are reported. Prints exit code, whether an STL was written,
// and the raw compiler log for a syntax error, a warning-only file, and an empty result.
import { readFileSync } from 'node:fs';
import { compile } from './compile.mjs';

const here = new URL('.', import.meta.url);
const cases = [
  ['syntax error (parts/broken.scad)', readFileSync(new URL('parts/broken.scad', here), 'utf8'), []],
  ['warnings only (parts/warning.scad)', readFileSync(new URL('parts/warning.scad', here), 'utf8'), []],
  ['warnings + --hardwarnings', readFileSync(new URL('parts/warning.scad', here), 'utf8'), ['--hardwarnings']],
  ['empty geometry', 'difference() { cube(5); cube(20, center = true); }', []],
  ['2D only, STL asked', 'circle(10);', []],
  ['assert fails', 'w = -3; assert(w > 0, "width must be positive"); cube(w);', []],
  ['runaway recursion', 'module r(n) { r(n + 1); } r(0);', []],
];
for (const [label, src, extraArgs] of cases) {
  const r = await compile(src, { extraArgs });
  console.log(`\n=== ${label}`);
  console.log(`ok=${r.ok} exitCode=${r.exitCode} stlBytes=${r.stl ? r.stl.length : 'none'} time=${Math.round(r.ms.total)}ms`);
  console.log(r.log.filter((l) => l.trim()).map((l) => '  | ' + l).join('\n'));
}
