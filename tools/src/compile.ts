import { existsSync } from 'node:fs';
import { Worker } from 'node:worker_threads';
import { cleanLog, findFailure, stlTriangles } from '../../app/src/scad/errors.ts';
import { findBannedCall } from '../../app/src/scad/guard.ts';
import { CRASH_MESSAGE, TIMEOUT_MESSAGE } from '../../app/src/scad/messages.ts';
import { applyOverrides, parseParams } from '../../app/src/scad/params.ts';
import type { Param } from '../../app/src/scad/types.ts';
import type { WorkerInput, WorkerReply } from './compile-worker.ts';

// The same pinned build the site serves (npm run fetch:openscad puts it there).
export const BUILD_DIR = new URL('../../app/public/openscad/', import.meta.url);

export type CompileResult = {
  ok: boolean;
  stl: Uint8Array | null;
  triangles: number;
  params: Param[];
  log: string[];
  ms: number;
  error: string | null;
};

// Same limit as the site; it starts once the compiler is loaded, as in the site's worker.
export const TIME_LIMIT_MS = 10000;

const failed = (error: string, log: string[] = [], ms = 0): CompileResult => ({
  ok: false,
  stl: null,
  triangles: 0,
  params: [],
  log,
  ms,
  error,
});

// Only plain numbers go through -D, as from the site's sliders.
function defineArgs(defines: Record<string, number>): string[] {
  const args: string[] = [];
  for (const [name, value] of Object.entries(defines)) {
    if (/^[A-Za-z_]\w*$/.test(name) && Number.isFinite(value)) args.push('-D', `${name}=${value}`);
  }
  return args;
}

/** Compiles OpenSCAD code to a binary STL with the site's build, flags and rules. */
export function compileScad(
  source: string,
  defines: Record<string, number> = {},
  timeoutMs = TIME_LIMIT_MS,
): Promise<CompileResult> {
  const banned = findBannedCall(source);
  if (banned) return Promise.resolve(failed(banned));
  if (!existsSync(new URL('openscad.wasm', BUILD_DIR))) {
    return Promise.resolve(failed('The OpenSCAD web build is missing. Run: npm run fetch:openscad'));
  }
  const input: WorkerInput = { buildDir: BUILD_DIR.href, source, args: defineArgs(defines) };
  const worker = new Worker(new URL('./compile-worker.ts', import.meta.url), { workerData: input });
  return new Promise((resolve) => {
    let started = performance.now();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const finish = (result: CompileResult) => {
      clearTimeout(timer);
      worker.removeAllListeners();
      void worker.terminate();
      resolve(result);
    };
    worker.on('message', (reply: WorkerReply) => {
      if (reply.type === 'ready') {
        started = performance.now();
        timer = setTimeout(() => finish(failed(TIMEOUT_MESSAGE, [], performance.now() - started)), timeoutMs);
        return;
      }
      const ms = performance.now() - started;
      const log = cleanLog(reply.log);
      const stl = reply.stl ? new Uint8Array(reply.stl) : null;
      const triangles = stlTriangles(stl);
      const error = findFailure(reply.exitCode, log, triangles);
      if (error || !stl) {
        finish(failed(error ?? 'No mesh was written.', log, ms));
        return;
      }
      finish({ ok: true, stl, triangles, params: applyOverrides(parseParams(reply.paramExport), defines), log, ms, error: null });
    });
    worker.on('error', (error: Error) => finish(failed(CRASH_MESSAGE, [error.message], performance.now() - started)));
    worker.on('exit', () => finish(failed(CRASH_MESSAGE, [], performance.now() - started)));
  });
}
