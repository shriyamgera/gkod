import { describe, expect, it, vi } from 'vitest';
import { createKeyStore, STORAGE_KEY, type StorageLike } from './keyStore';
import { DEFAULT_MODEL, engineSettings } from './settings';

class FakeStorage implements StorageLike {
  items = new Map<string, string>();
  getItem(name: string) {
    return this.items.get(name) ?? null;
  }
  setItem(name: string, value: string) {
    this.items.set(name, value);
  }
  removeItem(name: string) {
    this.items.delete(name);
  }
}

const throwing: StorageLike = {
  getItem: () => {
    throw new Error('SecurityError');
  },
  setItem: () => {
    throw new Error('QuotaExceededError');
  },
  removeItem: () => {
    throw new Error('SecurityError');
  },
};

describe('keyStore', () => {
  it('keeps the key in memory only unless remember is ticked', () => {
    const storage = new FakeStorage();
    const store = createKeyStore(() => storage);
    store.set('  AQ.test-key \n', false);
    expect(store.get()).toBe('AQ.test-key');
    expect(store.isRemembered()).toBe(false);
    expect(storage.items.size).toBe(0);
  });

  it('writes the key to storage when remembered, and a new page load reads it back', () => {
    const storage = new FakeStorage();
    createKeyStore(() => storage).set('AQ.test-key', true);
    expect(storage.items.get(STORAGE_KEY)).toBe('AQ.test-key');

    const reloaded = createKeyStore(() => storage);
    expect(reloaded.get()).toBe('AQ.test-key');
    expect(reloaded.isRemembered()).toBe(true);
  });

  it('removes a stored key when the key is set again without remember', () => {
    const storage = new FakeStorage();
    const store = createKeyStore(() => storage);
    store.set('AQ.old', true);
    store.set('AQ.new', false);
    expect(store.get()).toBe('AQ.new');
    expect(storage.items.size).toBe(0);
  });

  it('forget clears memory and storage', () => {
    const storage = new FakeStorage();
    const store = createKeyStore(() => storage);
    store.set('AQ.test-key', true);
    store.forget();
    expect(store.get()).toBeNull();
    expect(store.isRemembered()).toBe(false);
    expect(storage.items.size).toBe(0);
    expect(createKeyStore(() => storage).get()).toBeNull();
  });

  it('treats an empty key as forget', () => {
    const storage = new FakeStorage();
    const store = createKeyStore(() => storage);
    store.set('AQ.test-key', true);
    store.set('   ', true);
    expect(store.get()).toBeNull();
    expect(storage.items.size).toBe(0);
  });

  it('still works in memory when storage throws', () => {
    const store = createKeyStore(() => throwing);
    expect(store.get()).toBeNull();
    store.set('AQ.test-key', true);
    expect(store.get()).toBe('AQ.test-key');
    expect(store.isRemembered()).toBe(false);
    store.forget();
    expect(store.get()).toBeNull();
  });

  it('still works when reaching storage at all throws', () => {
    const store = createKeyStore(() => {
      throw new Error('SecurityError');
    });
    store.set('AQ.test-key', true);
    expect(store.get()).toBe('AQ.test-key');
    expect(store.isRemembered()).toBe(false);
  });

  it('tells subscribers about changes and keeps the same snapshot between them', () => {
    const store = createKeyStore(() => new FakeStorage());
    const listener = vi.fn();
    const stop = store.subscribe(listener);
    const before = store.snapshot();
    expect(store.snapshot()).toBe(before);
    store.set('AQ.test-key', false);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(store.snapshot()).toEqual({ key: 'AQ.test-key', remembered: false });
    stop();
    store.forget();
    expect(listener).toHaveBeenCalledTimes(1);
  });
});

describe('engineSettings', () => {
  it('starts on the default model and tells subscribers about a change', () => {
    expect(engineSettings.model()).toBe(DEFAULT_MODEL);
    const listener = vi.fn();
    const stop = engineSettings.subscribe(listener);
    engineSettings.setModel('gemini-3-flash-preview');
    engineSettings.setModel('gemini-3-flash-preview');
    expect(engineSettings.model()).toBe('gemini-3-flash-preview');
    expect(listener).toHaveBeenCalledTimes(1);
    engineSettings.setModel(DEFAULT_MODEL);
    stop();
  });
});
