import { useSyncExternalStore } from 'react';
import type { EngineId } from './types';

export const DEFAULT_MODEL = 'gemini-3.1-flash-lite';
export const DEFAULT_CLAUDE_MODEL = 'sonnet';
export const ENGINE_STORAGE_KEY = 'gkod.engine';

type StorageLike = Pick<Storage, 'getItem' | 'setItem'>;

type State = { engine: EngineId; models: Record<EngineId, string> };

function attempt<T>(action: () => T, fallback: T): T {
  try {
    return action();
  } catch {
    return fallback;
  }
}

// The chosen models are kept in memory only; a new visit starts on the defaults. The chosen engine is also
// copied to this tab's sessionStorage, like the parts, so a reload keeps it.
export function createSettings(getStorage: () => StorageLike | null = () => null) {
  const listeners = new Set<() => void>();
  const saved = attempt(() => getStorage()?.getItem(ENGINE_STORAGE_KEY), null);
  let state: State = {
    engine: saved === 'claude-code' ? 'claude-code' : 'gemini',
    models: { gemini: DEFAULT_MODEL, 'claude-code': DEFAULT_CLAUDE_MODEL },
  };

  function update(next: State) {
    state = next;
    listeners.forEach((listener) => listener());
  }

  return {
    engine: () => state.engine,
    setEngine(engine: EngineId) {
      if (engine === state.engine) return;
      attempt(() => getStorage()?.setItem(ENGINE_STORAGE_KEY, engine), undefined);
      update({ ...state, engine });
    },
    // the model chosen for an engine; Gemini's when none is named, as before there was a choice of engine
    model: (engine: EngineId = 'gemini') => state.models[engine],
    setModel(id: string, engine: EngineId = 'gemini') {
      if (!id || id === state.models[engine]) return;
      update({ ...state, models: { ...state.models, [engine]: id } });
    },
    snapshot: () => state,
    subscribe(fn: () => void) {
      listeners.add(fn);
      return () => {
        listeners.delete(fn);
      };
    },
  };
}

export const engineSettings = createSettings(() => (typeof window === 'undefined' ? null : window.sessionStorage));

export function useEngineModel(engine: EngineId = 'gemini'): string {
  const read = () => engineSettings.model(engine);
  return useSyncExternalStore(engineSettings.subscribe, read, read);
}

export function useEngineChoice(): EngineId {
  return useSyncExternalStore(engineSettings.subscribe, engineSettings.engine, engineSettings.engine);
}
