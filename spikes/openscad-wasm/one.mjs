// One compile in a fresh process. Usage: node one.mjs <file.scad> [backend] [-D name=value ...]
// Prints timings, mesh check and the full compiler log. Exit code 0 = compiled.
import { readFileSync } from 'node:fs';
import { compile } from './compile.mjs';
import { checkStl } from './meshcheck.mjs';

const tStart = performance.now();
const [file, backend = 'manifold', ...rest] = process.argv.slice(2);
const r = await compile(readFileSync(file, 'utf8'), { backend, extraArgs: rest });
const mesh = r.stl && r.stl.length > 84 ? checkStl(r.stl) : null;
console.log(JSON.stringify({
  file, backend, ok: r.ok, exitCode: r.exitCode,
  ms: { init: Math.round(r.ms.init), run: Math.round(r.ms.run), inProcessTotal: Math.round(performance.now() - tStart) },
  triangles: mesh?.triangles, watertight: mesh?.watertight, volumeMm3: mesh?.volumeMm3, bbox: mesh?.bbox,
  errors: r.errors, warnings: r.warnings,
}));
if (process.env.SHOW_LOG) console.log(r.log.join('\n'));
process.exit(r.ok ? 0 : 1);
