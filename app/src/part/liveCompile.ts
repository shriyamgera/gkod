import { CANCEL_MESSAGE, type CompileOptions, CRASH_MESSAGE, LOAD_MESSAGE, TIMEOUT_MESSAGE } from '../scad/client';
import type { CompileResult, Param } from '../scad/types';

export type Sizes = Record<string, number>;

export type Shown = { stl: ArrayBuffer; params: Param[]; ms: number };

export type LiveState = {
  // loading: the 3D engine is still being fetched; working: a model is being made or a change is waiting
  status: 'loading' | 'working' | 'idle';
  // the last model that compiled; it stays on screen while a newer one is made, or when one fails
  shown: Shown | null;
  // the sizes and their starting values, from the first model that compiled
  defaults: Param[] | null;
  problem: Problem | null;
};

// error: the code itself failed; load: the compiler files did not arrive; crash: the compiler stopped
export type Problem = { kind: 'error' | 'timeout' | 'load' | 'crash'; message: string };

const kinds: Record<string, Problem['kind']> = {
  [TIMEOUT_MESSAGE]: 'timeout',
  [LOAD_MESSAGE]: 'load',
  [CRASH_MESSAGE]: 'crash',
};

type CompileFn = (source: string, overrides: Sizes, opts: CompileOptions) => Promise<CompileResult>;

type Options = {
  source: string;
  compile: CompileFn;
  onChange: (state: LiveState) => void;
  delayMs?: number;
  // an out-of-date compile is cancelled once it has run this long; quicker ones are left to finish,
  // because cancelling a running compile restarts the compiler
  cancelAfterMs?: number;
  engine?: { ready: boolean };
};

export const initialState: LiveState = { status: 'idle', shown: null, defaults: null, problem: null };

// The compiler is shared by every part screen, so once it has loaded it stays loaded.
const sharedEngine = { ready: false };

// What a part screen shows before its first compile is sent.
export function startState(): LiveState {
  return { ...initialState, status: sharedEngine.ready ? 'working' : 'loading' };
}

// Recompiles a part as its sizes change. Changes are debounced, only one compile runs at a time,
// and a result is shown only if no newer change came in while it was being made.
export function createLiveCompile({
  source,
  compile,
  onChange,
  delayMs = 150,
  cancelAfterMs = 300,
  engine = sharedEngine,
}: Options) {
  let state = initialState;
  let wanted: Sizes | null = null;
  let latest = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let running: { ticket: number; began: number; controller: AbortController } | null = null;
  let cancelTimer: ReturnType<typeof setTimeout> | null = null;
  let stopped = false;

  function set(patch: Partial<LiveState>) {
    state = { ...state, ...patch };
    onChange(state);
  }

  function apply(result: CompileResult, sizes: Sizes) {
    if (result.ok) {
      const fresh = Object.keys(sizes).length === 0;
      set({
        status: 'idle',
        shown: { stl: result.stl, params: result.params, ms: result.ms },
        defaults: state.defaults ?? (fresh ? result.params : null),
        problem: null,
      });
    } else {
      set({ status: 'idle', problem: { kind: kinds[result.error] ?? 'error', message: result.error } });
    }
  }

  // Its result would be thrown away, so a slow compile is not left to hold up the next one.
  function cancelIfOutdated() {
    if (!running || (!stopped && running.ticket === latest)) return;
    const age = performance.now() - running.began;
    if (age >= cancelAfterMs) {
      running.controller.abort();
    } else if (!cancelTimer) {
      cancelTimer = setTimeout(() => {
        cancelTimer = null;
        cancelIfOutdated();
      }, cancelAfterMs - age);
    }
  }

  function run() {
    timer = null;
    if (running || !wanted || stopped) return;
    const sizes = wanted;
    const ticket = latest;
    const controller = new AbortController();
    wanted = null;
    running = { ticket, began: performance.now(), controller };
    set({ status: engine.ready ? 'working' : 'loading' });

    const onStart = () => {
      engine.ready = true;
      if (!stopped && state.status === 'loading') set({ status: 'working' });
    };
    void compile(source, sizes, { onStart, signal: controller.signal }).then((result) => {
      running = null;
      if (cancelTimer) clearTimeout(cancelTimer);
      cancelTimer = null;
      if (stopped) return;
      const cancelled = !result.ok && result.error === CANCEL_MESSAGE;
      if (ticket === latest && !cancelled) apply(result, sizes);
      else if (wanted && !timer) run();
    });
  }

  function request(sizes: Sizes, { now = false }: { now?: boolean } = {}) {
    if (stopped) return;
    wanted = sizes;
    latest += 1;
    if (timer) clearTimeout(timer);
    timer = null;
    if (now) run();
    else timer = setTimeout(run, delayMs);
    cancelIfOutdated();
    if (state.status === 'idle') set({ status: engine.ready ? 'working' : 'loading' });
  }

  function dispose() {
    stopped = true;
    if (timer) clearTimeout(timer);
    timer = null;
    cancelIfOutdated();
  }

  return { request, dispose };
}
