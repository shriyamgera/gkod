import {
  CANCEL_MESSAGE,
  CRASH_MESSAGE,
  LOAD_MESSAGE,
  SLICE_MESSAGE,
  type SliceReply,
  type SliceRequest,
  TIMEOUT_MESSAGE,
  TOO_BIG_MESSAGE,
  UNSAFE_MESSAGE,
} from './messages';
import type { SliceResult, SliceSettings } from './types';

export type WorkerLike = {
  postMessage(message: SliceRequest, transfer: Transferable[]): void;
  terminate(): void;
  onmessage: ((event: MessageEvent<SliceReply>) => void) | null;
  onerror: ((event: ErrorEvent) => void) | null;
};

export type SliceOptions = { timeoutMs?: number; signal?: AbortSignal; onProgress?: (fraction: number) => void };

export { CANCEL_MESSAGE, CRASH_MESSAGE, LOAD_MESSAGE, SLICE_MESSAGE, TIMEOUT_MESSAGE, TOO_BIG_MESSAGE, UNSAFE_MESSAGE };

export const DEFAULT_TIMEOUT_MS = 120000;
// Fetching the slicer (about 9 MB) has its own limit, so a slow first download is not reported as a slow slice.
const LOAD_TIMEOUT_MS = 60000;

export function createSlicer(makeWorker: () => WorkerLike) {
  let worker: WorkerLike | null = null;
  let queue: Promise<unknown> = Promise.resolve();
  let nextId = 1;

  // The next slice makes the new worker, so its handlers are in place before its script loads.
  function restart() {
    worker?.terminate();
    worker = null;
  }

  function runOne(stl: ArrayBuffer, settings: SliceSettings, opts: SliceOptions) {
    const { signal, onProgress } = opts;
    const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    return new Promise<SliceResult>((resolve) => {
      const began = performance.now();
      const ms = () => performance.now() - began;
      if (signal?.aborted) {
        resolve({ ok: false, error: CANCEL_MESSAGE, ms: 0 });
        return;
      }
      const id = nextId++;
      worker ??= makeWorker();
      const current = worker;
      let timer: ReturnType<typeof setTimeout>;

      const finish = (result: SliceResult) => {
        clearTimeout(timer);
        signal?.removeEventListener('abort', onAbort);
        current.onmessage = null;
        current.onerror = null;
        resolve(result);
      };
      // A running slice cannot be interrupted, so the worker is ended and the next slice starts a new one.
      const stop = (error: string) => {
        restart();
        finish({ ok: false, error, ms: ms() });
      };
      function onAbort() {
        stop(CANCEL_MESSAGE);
      }
      signal?.addEventListener('abort', onAbort);

      timer = setTimeout(() => stop(LOAD_MESSAGE), LOAD_TIMEOUT_MS);
      current.onmessage = ({ data }) => {
        if (data.id !== id) return;
        if (data.type === 'start') {
          clearTimeout(timer);
          timer = setTimeout(() => stop(TIMEOUT_MESSAGE), timeoutMs);
        } else if (data.type === 'progress') {
          onProgress?.(data.fraction);
        } else if (!data.ok) {
          finish({ ok: false, error: data.error, ms: ms(), ...(data.safety ? { safety: data.safety } : {}) });
        } else if (!data.safety.ok) {
          // the worker never sends this, but a file that failed the check must never be offered
          finish({ ok: false, error: UNSAFE_MESSAGE, ms: ms(), safety: data.safety });
        } else {
          onProgress?.(1);
          const { gcode, seconds, filamentMm, layers, safety } = data;
          finish({ ok: true, gcode, seconds, filamentMm, layers, ms: ms(), safety });
        }
      };
      current.onerror = (event) => {
        event.preventDefault?.();
        stop(CRASH_MESSAGE);
      };
      // a copy, so the caller's buffer stays usable
      const copy = stl.slice(0);
      current.postMessage({ type: 'slice', id, stl: copy, settings }, [copy]);
    });
  }

  // Slices run one at a time, in the order they were asked for.
  return function slice(stl: ArrayBuffer, settings: SliceSettings, opts: SliceOptions = {}): Promise<SliceResult> {
    const result = queue.then(() => runOne(stl, settings, opts));
    queue = result;
    return result;
  };
}

let shared: ReturnType<typeof createSlicer> | null = null;

/** Slices a binary STL in a Web Worker and checks the G-code before it resolves. A failed check resolves ok: false. */
export function slice(stl: ArrayBuffer, settings: SliceSettings, opts?: SliceOptions): Promise<SliceResult> {
  shared ??= createSlicer(
    () => new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' }) as unknown as WorkerLike,
  );
  return shared(stl, settings, opts);
}
