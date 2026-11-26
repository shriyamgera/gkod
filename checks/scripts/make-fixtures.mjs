// Rebuilds test/fixtures/*.stl from the built-in examples at their default sizes,
// with the same OpenSCAD web build and options as the site's compile worker.
// Needs the build in app/public/openscad (npm run fetch:openscad).
import { existsSync, readFileSync, writeFileSync } from 'node:fs';

const root = new URL('../../', import.meta.url);
const build = new URL('app/public/openscad/', root);
const examples = ['phone_stand', 'wall_hook', 'cable_clip', 'test_cube'];
const sources = {};

// The same hash as test/examples.test.ts, so the test can tell when an example changed after its fixture was made.
function hash(text) {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 0x01000193);
  return (h >>> 0).toString(16);
}

if (!existsSync(new URL('openscad.wasm', build))) {
  console.error('No OpenSCAD build in app/public/openscad. Run: npm run fetch:openscad');
  process.exit(1);
}

const factory = (await import(new URL('openscad.js', build).href)).default;
const wasm = await WebAssembly.compile(readFileSync(new URL('openscad.wasm', build)));

for (const id of examples) {
  const source = readFileSync(new URL(`app/src/examples/${id}.scad`, root), 'utf8');
  const log = [];
  const instance = await factory({
    noInitialRun: true,
    print: (line) => log.push(line),
    printErr: (line) => log.push(line),
    instantiateWasm: (imports, done) => {
      WebAssembly.instantiate(wasm, imports).then((made) => done(made, wasm));
      return {};
    },
  });
  instance.FS.writeFile('/in.scad', source);
  const code = instance.callMain(['/in.scad', '-o', '/out.stl', '--export-format=binstl', '--backend=manifold', '--hardwarnings']);
  if (code !== 0) {
    console.error(`${id} did not compile:\n${log.join('\n')}`);
    process.exit(1);
  }
  const stl = instance.FS.readFile('/out.stl');
  sources[id] = hash(source);
  writeFileSync(new URL(`../test/fixtures/${id}.stl`, import.meta.url), stl);
  console.log(`${id}.stl: ${stl.byteLength} bytes, ${(stl.byteLength - 84) / 50} triangles`);
}
writeFileSync(new URL('../test/fixtures/sources.json', import.meta.url), `${JSON.stringify(sources, null, 2)}\n`);
