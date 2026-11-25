// Can one WASM instance be reused for several compiles (callMain called twice)?
import { readFileSync } from 'node:fs';
const here = new URL('.', import.meta.url);
const OpenSCAD = (await import(new URL('vendor/web/openscad.js', here))).default;
const inst = await OpenSCAD({ noInitialRun: true, print: () => {}, printErr: () => {},
  wasmBinary: readFileSync(new URL('vendor/web/openscad.wasm', here)) });
for (let i = 1; i <= 3; i++) {
  inst.FS.writeFile('/in.scad', `cube(${i * 10});`);
  try {
    const code = inst.callMain(['/in.scad', '-o', `/out${i}.stl`, '--export-format=binstl']);
    console.log(`call ${i}: exit ${code}, stl bytes ${inst.FS.readFile(`/out${i}.stl`).length}`);
  } catch (e) {
    console.log(`call ${i}: threw ${e?.name || ''} ${e?.message || e?.status || e}`);
  }
}
