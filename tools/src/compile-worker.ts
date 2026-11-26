// Runs one compile with the OpenSCAD web build, in a worker thread so the caller can stop it on a time limit.
import { readFileSync } from 'node:fs';
import { parentPort, workerData } from 'node:worker_threads';

type Instance = {
  FS: { writeFile(path: string, data: string): void; readFile(path: string): Uint8Array };
  callMain(args: string[]): number;
};

type Factory = (options: object) => Promise<Instance>;

// The few WebAssembly calls used here; Node has them, but its type package does not declare them.
declare const WebAssembly: {
  compile(bytes: Uint8Array): Promise<object>;
  instantiate(module: object, imports: object): Promise<object>;
};

export type WorkerInput = { buildDir: string; source: string; args: string[] };
export type WorkerReply =
  | { type: 'ready' }
  | { type: 'done'; exitCode: number; log: string[]; stl: Uint8Array | null; paramExport: string };

const { buildDir, source, args } = workerData as WorkerInput;
const factory = ((await import(new URL('openscad.js', buildDir).href)) as { default: Factory }).default;
const wasm = await WebAssembly.compile(readFileSync(new URL('openscad.wasm', buildDir)));
const post = (reply: WorkerReply) => parentPort!.postMessage(reply);

// One OpenSCAD instance can run main only once, so each run gets a new one.
async function run(outPath: string, extra: string[]) {
  const log: string[] = [];
  const instance = await factory({
    noInitialRun: true,
    print: (line: string) => log.push(line),
    printErr: (line: string) => log.push(line),
    instantiateWasm: (imports: object, done: (made: object, module: object) => void) => {
      void WebAssembly.instantiate(wasm, imports).then((made) => done(made, wasm));
      return {};
    },
  });
  instance.FS.writeFile('/in.scad', source);
  let exitCode: number;
  try {
    exitCode = instance.callMain(['/in.scad', '-o', outPath, ...extra]);
  } catch (thrown) {
    const status = (thrown as { status?: unknown } | null)?.status;
    exitCode = typeof status === 'number' ? status : -1;
    if (typeof status !== 'number') log.push(`EXCEPTION: ${thrown instanceof Error ? thrown.message : String(thrown)}`);
  }
  let output: Uint8Array | null = null;
  try {
    output = instance.FS.readFile(outPath);
  } catch {
    // nothing was written
  }
  return { exitCode, log, output };
}

post({ type: 'ready' });
const part = await run('/out.stl', ['--export-format=binstl', '--backend=manifold', '--hardwarnings', ...args]);
let paramExport = '';
if (part.exitCode === 0 && part.output) {
  const params = await run('/params.json', ['--export-format=param']);
  if (params.output) paramExport = new TextDecoder().decode(params.output);
}
post({ type: 'done', exitCode: part.exitCode, log: part.log, stl: part.output, paramExport });
