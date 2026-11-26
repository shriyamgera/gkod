import { useSyncExternalStore } from 'react';

export const DEFAULT_MODEL = 'gemini-3.1-flash-lite';

// The chosen model is kept in memory only; a new visit starts on the default.
function createSettings() {
  const listeners = new Set<() => void>();
  let model = DEFAULT_MODEL;
  return {
    model: () => model,
    setModel(id: string) {
      if (!id || id === model) return;
      model = id;
      listeners.forEach((listener) => listener());
    },
    subscribe(fn: () => void) {
      listeners.add(fn);
      return () => {
        listeners.delete(fn);
      };
    },
  };
}

export const engineSettings = createSettings();

export function useEngineModel(): string {
  return useSyncExternalStore(engineSettings.subscribe, engineSettings.model, engineSettings.model);
}
