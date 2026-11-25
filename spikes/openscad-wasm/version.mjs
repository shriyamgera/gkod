// Print the OpenSCAD version and build info of the WebAssembly build.
import { readFileSync } from 'node:fs';
const here = new URL('.', import.meta.url);
const OpenSCAD = (await import(new URL('vendor/web/openscad.js', here))).default;
for (const args of [['--version'], ['--info'], ['--help']]) {
  const out = [];
  const inst = await OpenSCAD({ noInitialRun: true, print: (s) => out.push(s), printErr: (s) => out.push(s),
    wasmBinary: readFileSync(new URL('vendor/web/openscad.wasm', here)) });
  try { inst.callMain(args); } catch (e) { /* exit status */ }
  console.log(`--- ${args[0]}\n${out.join('\n')}`);
}
