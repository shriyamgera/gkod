import { useSyncExternalStore } from 'react';

export const STORAGE_KEY = 'gkod.geminiKey';

export type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

type Snapshot = { key: string | null; remembered: boolean };

// Private windows and blocked site data can make any storage call throw, so each one is guarded.
function attempt<T>(action: () => T, fallback: T): T {
  try {
    return action();
  } catch {
    return fallback;
  }
}

// The key lives in memory. Only when the visitor ticks "remember" is it also written to storage.
export function createKeyStore(getStorage: () => StorageLike | null) {
  const listeners = new Set<() => void>();
  let snapshot: Snapshot | null = null;

  const storage = () => attempt(getStorage, null);

  function current(): Snapshot {
    if (!snapshot) {
      const saved = attempt(() => storage()?.getItem(STORAGE_KEY) ?? null, null);
      snapshot = saved ? { key: saved, remembered: true } : { key: null, remembered: false };
    }
    return snapshot;
  }

  function update(next: Snapshot) {
    snapshot = next;
    listeners.forEach((listener) => listener());
  }

  function forget() {
    attempt(() => storage()?.removeItem(STORAGE_KEY), undefined);
    update({ key: null, remembered: false });
  }

  function set(key: string, remember: boolean) {
    const clean = key.trim();
    if (!clean) return forget();
    let remembered = false;
    if (remember) {
      remembered = attempt(() => {
        const target = storage();
        target?.setItem(STORAGE_KEY, clean);
        return target !== null;
      }, false);
    } else {
      attempt(() => storage()?.removeItem(STORAGE_KEY), undefined);
    }
    update({ key: clean, remembered });
  }

  return {
    get: () => current().key,
    set,
    forget,
    isRemembered: () => current().remembered,
    snapshot: current,
    subscribe(fn: () => void) {
      listeners.add(fn);
      return () => {
        listeners.delete(fn);
      };
    },
  };
}

export const keyStore = createKeyStore(() => (typeof window === 'undefined' ? null : window.localStorage));

export function useGeminiKey(): { key: string | null; remembered: boolean } {
  return useSyncExternalStore(keyStore.subscribe, keyStore.snapshot, keyStore.snapshot);
}
