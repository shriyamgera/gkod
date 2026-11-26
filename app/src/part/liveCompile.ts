import { type CompileOptions, TIMEOUT_MESSAGE } from '../scad/client';
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
  problem: { kind: 'error' | 'timeout'; message: string } | null;
};

type CompileFn = (source: string, overrides: Sizes, opts: CompileOptions) => Promise<CompileResult>;

type Options = {
  source: string;
  compile: CompileFn;
  onChange: (state: LiveState) => void;
  delayMs?: number;
  engine?: { ready: boolean };
};

export const initialState: LiveState = { status: 'idle', shown: null, defaults: null, problem: null };

// The compiler is shared by every part screen, so once it has loaded it stays loaded.
const sharedEngine = { ready: false };

// Recompiles a part as its sizes change. Changes are debounced, only one compile runs at a time,
// and a result is shown only if no newer change came in while it was being made.
export function createLiveCompile({ source, compile, onChange, delayMs = 150, engine = sharedEngine }: Options) {
  let state = initialState;
  let wanted: Sizes | null = null;
  let latest = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let running = false;
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
      const kind = result.error === TIMEOUT_MESSAGE ? 'timeout' : 'error';
      set({ status: 'idle', problem: { kind, message: result.error } });
    }
  }

  function run() {
    timer = null;
    if (running || !wanted || stopped) return;
    const sizes = wanted;
    const ticket = latest;
    wanted = null;
    running = true;
    set({ status: engine.ready ? 'working' : 'loading' });

    const onStart = () => {
      engine.ready = true;
      if (!stopped && state.status === 'loading') set({ status: 'working' });
    };
    void compile(source, sizes, { onStart }).then((result) => {
      running = false;
      if (stopped) return;
      if (ticket === latest) apply(result, sizes);
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
    if (state.status === 'idle') set({ status: engine.ready ? 'working' : 'loading' });
  }

  function dispose() {
    stopped = true;
    if (timer) clearTimeout(timer);
    timer = null;
  }

  return { request, dispose };
}
