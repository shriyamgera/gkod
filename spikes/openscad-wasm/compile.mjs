// Compile OpenSCAD source to a binary STL using the official WebAssembly builds.
// One fresh WASM instance per compile (callMain is one-shot, like a CLI process).
//
// Two builds are supported:
//   'node' : vendor/node-module/openscad.js  (wasm embedded, NODERAWFS = reads/writes real files)
//   'web'  : vendor/web/openscad.js + openscad.wasm (in-memory filesystem; same files a browser uses)
import { mkdtempSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = new URL('.', import.meta.url);
let factories = {};
let webWasmModule = null;

async function getFactory(build) {
  if (!factories[build]) {
    const dir = build === 'web' ? 'web' : 'node-module';
    factories[build] = (await import(new URL(`vendor/${dir}/openscad.js`, here))).default;
    if (build === 'web') {
      // Compile the .wasm once; every instance then reuses the compiled module.
      webWasmModule = await WebAssembly.compile(readFileSync(new URL('vendor/web/openscad.wasm', here)));
    }
  }
  return factories[build];
}

export function defineArgs(defines = {}) {
  const args = [];
  for (const [k, v] of Object.entries(defines)) args.push('-D', `${k}=${JSON.stringify(v)}`);
  return args;
}

/**
 * @param {string} source   OpenSCAD code
 * @param {object} [opts]
 * @param {'node'|'web'} [opts.build]   default 'web'
 * @param {Record<string, number|string|boolean|number[]>} [opts.defines]  -D overrides
 * @param {string} [opts.backend]  'manifold' (default) or 'cgal'
 * @param {string[]} [opts.extraArgs]
 */
export async function compile(source, opts = {}) {
  const build = opts.build || 'web';
  const log = [];
  const t0 = performance.now();
  const factory = await getFactory(build);
  const moduleArg = {
    noInitialRun: true,
    print: (s) => log.push(s),
    printErr: (s) => log.push(s),
    // The node build would otherwise call process.exit() when main() returns.
    quit: (status, toThrow) => { throw toThrow; },
  };
  if (build === 'web') {
    moduleArg.instantiateWasm = (imports, done) => {
      WebAssembly.instantiate(webWasmModule, imports).then((instance) => done(instance, webWasmModule));
      return {};
    };
  }
  const inst = await factory(moduleArg);
  const t1 = performance.now();

  let inPath = '/in.scad', outPath = '/out.stl', tmp = null;
  if (build === 'node') {
    tmp = mkdtempSync(join(tmpdir(), 'scad-'));
    inPath = join(tmp, 'in.scad'); outPath = join(tmp, 'out.stl');
    writeFileSync(inPath, source);
  } else {
    inst.FS.writeFile(inPath, source);
  }
  const args = [inPath, '-o', outPath, '--export-format=binstl',
    `--backend=${opts.backend || 'manifold'}`, ...defineArgs(opts.defines), ...(opts.extraArgs || [])];
  let exitCode;
  try {
    exitCode = inst.callMain(args);
  } catch (e) {
    exitCode = typeof e?.status === 'number' ? e.status : -1;
    if (typeof e?.status !== 'number') log.push(`EXCEPTION: ${e?.message || e}`);
  }
  let stl = null;
  try {
    if (build === 'node') { if (existsSync(outPath)) stl = new Uint8Array(readFileSync(outPath)); }
    else stl = inst.FS.readFile(outPath);
  } catch { /* no output written */ }
  if (tmp) rmSync(tmp, { recursive: true, force: true });
  const t2 = performance.now();
  const errors = log.filter((l) => /^(ERROR|EXCEPTION)/.test(l));
  const warnings = log.filter((l) => /^(WARNING|DEPRECATED)/.test(l));
  return {
    ok: exitCode === 0 && !!stl && stl.length > 84,
    exitCode, stl, log, errors, warnings, args,
    ms: { init: t1 - t0, run: t2 - t1, total: t2 - t0 },
  };
}
