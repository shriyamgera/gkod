import { useSyncExternalStore } from 'react';

export const STORAGE_KEY = 'gkod.geminiKey';
export const PAIRING_STORAGE_KEY = 'gkod.bridgePairing';

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
// The same store keeps the Claude Code bridge's pairing code, under its own storage key.
export function createKeyStore(getStorage: () => StorageLike | null, storageKey = STORAGE_KEY) {
  const listeners = new Set<() => void>();
  let snapshot: Snapshot | null = null;

  const storage = () => attempt(getStorage, null);

  function current(): Snapshot {
    if (!snapshot) {
      const saved = attempt(() => storage()?.getItem(storageKey) ?? null, null);
      snapshot = saved ? { key: saved, remembered: true } : { key: null, remembered: false };
    }
    return snapshot;
  }

  function update(next: Snapshot) {
    snapshot = next;
    listeners.forEach((listener) => listener());
  }

  function forget() {
    attempt(() => storage()?.removeItem(storageKey), undefined);
    update({ key: null, remembered: false });
  }

  function set(key: string, remember: boolean) {
    const clean = key.trim();
    if (!clean) return forget();
    let remembered = false;
    if (remember) {
      remembered = attempt(() => {
        const target = storage();
        target?.setItem(storageKey, clean);
        return target !== null;
      }, false);
    } else {
      attempt(() => storage()?.removeItem(storageKey), undefined);
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

const local = () => (typeof window === 'undefined' ? null : window.localStorage);

export const keyStore = createKeyStore(local);

export const pairingStore = createKeyStore(local, PAIRING_STORAGE_KEY);

export function useGeminiKey(): { key: string | null; remembered: boolean } {
  return useSyncExternalStore(keyStore.subscribe, keyStore.snapshot, keyStore.snapshot);
}

export function usePairingCode(): { key: string | null; remembered: boolean } {
  return useSyncExternalStore(pairingStore.subscribe, pairingStore.snapshot, pairingStore.snapshot);
}
