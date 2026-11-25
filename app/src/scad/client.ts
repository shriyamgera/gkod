import { findBannedCall } from './guard';
import type { WorkerReply, WorkerRequest } from './messages';
import { applyOverrides, parseParams } from './params';
import type { CompileResult } from './types';

export type WorkerLike = {
  postMessage(message: WorkerRequest): void;
  terminate(): void;
  onmessage: ((event: MessageEvent<WorkerReply>) => void) | null;
  onerror: ((event: ErrorEvent) => void) | null;
};

export type CompileOptions = { timeoutMs?: number };

export const TIMEOUT_MESSAGE = 'This took too long and was stopped.';
export const CRASH_MESSAGE = 'The compiler stopped unexpectedly. Try again.';
export const LOAD_MESSAGE = 'The compiler could not be loaded. Check your connection and try again.';

// Fetching the compiler has its own, longer limit so a slow first download is not reported as a slow part.
const LOAD_TIMEOUT_MS = 60000;

export function createCompiler(makeWorker: () => WorkerLike) {
  let worker: WorkerLike | null = null;
  let queue: Promise<unknown> = Promise.resolve();
  let nextId = 1;

  function restart() {
    worker?.terminate();
    worker = makeWorker();
  }

  function runOne(source: string, overrides: Record<string, number>, timeoutMs: number): Promise<CompileResult> {
    return new Promise((resolve) => {
      const began = performance.now();
      const id = nextId++;
      worker ??= makeWorker();
      const current = worker;
      let timer: ReturnType<typeof setTimeout>;

      const finish = (result: CompileResult) => {
        clearTimeout(timer);
        current.onmessage = null;
        current.onerror = null;
        resolve(result);
      };
      const stop = (error: string) => {
        restart();
        finish({ ok: false, error, log: [], ms: performance.now() - began });
      };

      timer = setTimeout(() => stop(LOAD_MESSAGE), LOAD_TIMEOUT_MS);
      current.onmessage = ({ data }) => {
        if (data.id !== id) return;
        if (data.type === 'start') {
          clearTimeout(timer);
          timer = setTimeout(() => stop(TIMEOUT_MESSAGE), timeoutMs);
        } else if (data.ok) {
          const params = applyOverrides(parseParams(data.paramExport), overrides);
          finish({ ok: true, stl: data.stl, params, log: data.log, ms: data.ms });
        } else {
          finish({ ok: false, error: data.error, log: data.log, ms: data.ms });
        }
      };
      current.onerror = (event) => {
        event.preventDefault?.();
        stop(CRASH_MESSAGE);
      };
      current.postMessage({ id, source, overrides });
    });
  }

  // Compiles run one at a time, in the order they were asked for.
  return function compile(
    source: string,
    overrides: Record<string, number> = {},
    { timeoutMs = 10000 }: CompileOptions = {},
  ): Promise<CompileResult> {
    const banned = findBannedCall(source);
    if (banned) return Promise.resolve({ ok: false, error: banned, log: [], ms: 0 });
    const result = queue.then(() => runOne(source, overrides, timeoutMs));
    queue = result;
    return result;
  };
}

let shared: ReturnType<typeof createCompiler> | null = null;

export function compile(
  source: string,
  overrides?: Record<string, number>,
  opts?: CompileOptions,
): Promise<CompileResult> {
  shared ??= createCompiler(
    () => new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' }) as unknown as WorkerLike,
  );
  return shared(source, overrides, opts);
}
