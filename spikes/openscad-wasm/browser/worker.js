// Module Web Worker: compiles OpenSCAD source to binary STL off the main thread.
// The .wasm is fetched and compiled once; each job gets a fresh instance (a few ms).
import OpenSCAD from './vendor/openscad.js';

let wasmModule = null;
let loadMs = 0;
async function load() {
  if (wasmModule) return;
  const t0 = performance.now();
  wasmModule = await WebAssembly.compileStreaming(fetch(new URL('./vendor/openscad.wasm', import.meta.url)));
  loadMs = performance.now() - t0;
}

self.onmessage = async (ev) => {
  const { id, source, defines = {}, extraArgs = [] } = ev.data;
  const log = [];
  const t0 = performance.now();
  await load();
  const inst = await OpenSCAD({
    noInitialRun: true,
    print: (s) => log.push(s),
    printErr: (s) => log.push(s),
    instantiateWasm: (imports, done) => {
      WebAssembly.instantiate(wasmModule, imports).then((instance) => done(instance, wasmModule));
      return {};
    },
  });
  inst.FS.writeFile('/in.scad', source);
  const args = ['/in.scad', '-o', '/out.stl', '--export-format=binstl', '--backend=manifold'];
  for (const [k, v] of Object.entries(defines)) args.push('-D', `${k}=${JSON.stringify(v)}`);
  args.push(...extraArgs);
  let exitCode;
  try { exitCode = inst.callMain(args); } catch (e) {
    exitCode = typeof e?.status === 'number' ? e.status : -1;
    if (typeof e?.status !== 'number') log.push(`EXCEPTION: ${e?.message || e}`);
  }
  let stl = null;
  try { stl = inst.FS.readFile('/out.stl'); } catch { /* nothing written */ }
  const ms = performance.now() - t0;
  self.postMessage({ id, ok: exitCode === 0 && !!stl, exitCode, log, ms, loadMs, stl: stl ? stl.buffer : null },
    stl ? [stl.buffer] : []);
};
