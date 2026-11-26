import { findBannedCall } from './guard';
import {
  CANCEL_MESSAGE,
  CRASH_MESSAGE,
  LOAD_MESSAGE,
  TIMEOUT_MESSAGE,
  type WorkerReply,
  type WorkerRequest,
} from './messages';
import { applyOverrides, parseParams } from './params';
import type { CompileResult } from './types';

export type WorkerLike = {
  postMessage(message: WorkerRequest): void;
  terminate(): void;
  onmessage: ((event: MessageEvent<WorkerReply>) => void) | null;
  onerror: ((event: ErrorEvent) => void) | null;
};

// onStart runs once the compiler is loaded and this compile begins, so a page can tell loading apart from compiling.
// Aborting signal cancels the compile: it resolves with CANCEL_MESSAGE.
export type CompileOptions = { timeoutMs?: number; onStart?: () => void; signal?: AbortSignal };

export { CANCEL_MESSAGE, CRASH_MESSAGE, LOAD_MESSAGE, TIMEOUT_MESSAGE };

// Fetching the compiler has its own, longer limit so a slow first download is not reported as a slow part.
const LOAD_TIMEOUT_MS = 60000;

export function createCompiler(makeWorker: () => WorkerLike) {
  let worker: WorkerLike | null = null;
  let queue: Promise<unknown> = Promise.resolve();
  let nextId = 1;

  // The next compile makes the new worker, so its error handler is in place before its script loads.
  function restart() {
    worker?.terminate();
    worker = null;
  }

  function runOne(source: string, overrides: Record<string, number>, timeoutMs: number, opts: CompileOptions) {
    const { onStart, signal } = opts;
    return new Promise<CompileResult>((resolve) => {
      const began = performance.now();
      if (signal?.aborted) {
        resolve({ ok: false, error: CANCEL_MESSAGE, log: [], ms: 0 });
        return;
      }
      const id = nextId++;
      worker ??= makeWorker();
      const current = worker;
      let timer: ReturnType<typeof setTimeout>;
      let started = false;

      const finish = (result: CompileResult) => {
        clearTimeout(timer);
        signal?.removeEventListener('abort', onAbort);
        current.onmessage = null;
        current.onerror = null;
        resolve(result);
      };
      const stop = (error: string) => {
        restart();
        finish({ ok: false, error, log: [], ms: performance.now() - began });
      };
      // A running compile blocks the worker, so the worker is ended. One still waiting for the compiler is only dropped.
      function onAbort() {
        if (started) stop(CANCEL_MESSAGE);
        else current.postMessage({ type: 'cancel', id });
      }
      signal?.addEventListener('abort', onAbort);

      timer = setTimeout(() => stop(LOAD_MESSAGE), LOAD_TIMEOUT_MS);
      current.onmessage = ({ data }) => {
        if (data.id !== id) return;
        if (data.type === 'start') {
          started = true;
          // the cancel crossed paths with the start
          if (signal?.aborted) return stop(CANCEL_MESSAGE);
          clearTimeout(timer);
          timer = setTimeout(() => stop(TIMEOUT_MESSAGE), timeoutMs);
          onStart?.();
        } else if (data.type === 'cancelled') {
          finish({ ok: false, error: CANCEL_MESSAGE, log: [], ms: performance.now() - began });
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
      current.postMessage({ type: 'compile', id, source, overrides });
    });
  }

  // Compiles run one at a time, in the order they were asked for.
  return function compile(
    source: string,
    overrides: Record<string, number> = {},
    opts: CompileOptions = {},
  ): Promise<CompileResult> {
    const banned = findBannedCall(source);
    if (banned) return Promise.resolve({ ok: false, error: banned, log: [], ms: 0 });
    const result = queue.then(() => runOne(source, overrides, opts.timeoutMs ?? 10000, opts));
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
