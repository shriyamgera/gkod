/// <reference lib="webworker" />
import { cleanLog, findFailure, stlTriangles } from './errors';
import type { WorkerReply, WorkerRequest } from './messages';

type OpenScadInstance = {
  FS: { writeFile(path: string, data: string): void; readFile(path: string): Uint8Array };
  callMain(args: string[]): number;
};

type OpenScadFactory = (options: {
  noInitialRun: boolean;
  print(line: string): void;
  printErr(line: string): void;
  instantiateWasm(
    imports: WebAssembly.Imports,
    done: (instance: WebAssembly.Instance, module: WebAssembly.Module) => void,
  ): object;
}) => Promise<OpenScadInstance>;

type Compiler = { factory: OpenScadFactory; wasm: WebAssembly.Module };

const scope = self as unknown as DedicatedWorkerGlobalScope;
const baseUrl = new URL(`${import.meta.env.BASE_URL}openscad/`, scope.location.href);

async function compileWasm(url: URL): Promise<WebAssembly.Module> {
  try {
    return await WebAssembly.compileStreaming(fetch(url));
  } catch {
    // Streaming needs the application/wasm type; some static hosts send another one.
    const response = await fetch(url);
    if (!response.ok) throw new Error(`could not fetch ${url.pathname} (${response.status})`);
    return WebAssembly.compile(await response.arrayBuffer());
  }
}

let loading: Promise<Compiler> | null = null;

// The wasm is fetched and compiled once; every compile then only makes a new instance of it.
function load(): Promise<Compiler> {
  loading ??= Promise.all([
    import(/* @vite-ignore */ new URL('openscad.js', baseUrl).href) as Promise<{ default: OpenScadFactory }>,
    compileWasm(new URL('openscad.wasm', baseUrl)),
  ]).then(([module, wasm]) => ({ factory: module.default, wasm }));
  loading.catch(() => {
    loading = null;
  });
  return loading;
}

type Run = { exitCode: number; log: string[]; output: Uint8Array | null };

// One OpenSCAD instance can run main only once, so each run gets a new one.
async function run(compiler: Compiler, source: string, outPath: string, args: string[]): Promise<Run> {
  const log: string[] = [];
  // If making the instance fails (e.g. no memory left), the factory's promise never settles, so race it.
  let failed: (reason: unknown) => void = () => {};
  const instantiateFailed = new Promise<never>((_, reject) => {
    failed = reject;
  });
  const instance = await Promise.race([
    compiler.factory({
      noInitialRun: true,
      print: (line) => log.push(line),
      printErr: (line) => log.push(line),
      instantiateWasm: (imports, done) => {
        WebAssembly.instantiate(compiler.wasm, imports)
          .then((made) => done(made, compiler.wasm))
          .catch(failed);
        return {};
      },
    }),
    instantiateFailed,
  ]);
  instance.FS.writeFile('/in.scad', source);
  let exitCode: number;
  try {
    exitCode = instance.callMain(['/in.scad', '-o', outPath, ...args]);
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
  return { exitCode, log: cleanLog(log), output };
}

function defineArgs(overrides: Record<string, number>): string[] {
  const args: string[] = [];
  for (const [name, value] of Object.entries(overrides)) {
    if (/^[A-Za-z_]\w*$/.test(name) && Number.isFinite(value)) args.push('-D', `${name}=${value}`);
  }
  return args;
}

let lastParams: { source: string; json: string } | null = null;

async function exportParams(compiler: Compiler, source: string): Promise<string> {
  if (lastParams?.source === source) return lastParams.json;
  const result = await run(compiler, source, '/params.json', ['--export-format=param']);
  const json = result.output ? new TextDecoder().decode(result.output) : '';
  lastParams = { source, json };
  return json;
}

async function handle({ id, source, overrides }: WorkerRequest): Promise<void> {
  const reply = (message: WorkerReply, transfer: Transferable[] = []) => scope.postMessage(message, transfer);
  let compiler: Compiler;
  try {
    compiler = await load();
  } catch (thrown) {
    const detail = thrown instanceof Error ? thrown.message : String(thrown);
    reply({ type: 'done', id, ok: false, error: 'The compiler could not be loaded.', log: [detail], ms: 0 });
    return;
  }
  reply({ type: 'start', id });
  const started = performance.now();
  try {
    const args = ['--export-format=binstl', '--backend=manifold', ...defineArgs(overrides)];
    const result = await run(compiler, source, '/out.stl', args);
    const error = findFailure(result.exitCode, result.log, stlTriangles(result.output));
    if (error || !result.output) {
      const ms = performance.now() - started;
      reply({ type: 'done', id, ok: false, error: error ?? 'No mesh was written.', log: result.log, ms });
      return;
    }
    const paramExport = await exportParams(compiler, source);
    const bytes = result.output;
    const stl = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
    const ms = performance.now() - started;
    reply({ type: 'done', id, ok: true, stl, paramExport, log: result.log, ms }, [stl]);
  } catch (thrown) {
    const detail = thrown instanceof Error ? thrown.message : String(thrown);
    const ms = performance.now() - started;
    reply({ type: 'done', id, ok: false, error: 'The compiler stopped unexpectedly.', log: [detail], ms });
  }
}

scope.onmessage = (event: MessageEvent<WorkerRequest>) => {
  void handle(event.data);
};

void load().catch(() => {});
