import { describe, expect, it } from 'vitest';
import { createModelStore, currentVersion, STORAGE_KEY } from './store';

function memoryStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return {
    data,
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => void data.set(key, value),
  };
}

function setup(storage: ReturnType<typeof memoryStorage> | null = memoryStorage()) {
  let id = 0;
  let time = 1000;
  const store = createModelStore({
    getStorage: () => storage,
    now: () => (time += 1),
    makeId: () => `m${(id += 1)}`,
  });
  return { store, storage };
}

const first = { title: 'Phone stand', request: 'Phone stand, 80 mm wide', code: 'width = 80;', label: 'First version' };

describe('model store', () => {
  it('creates a part with one version and lists the newest first', () => {
    const { store } = setup();
    const a = store.create({ ...first, model: 'gemini-3.1-flash-lite' });
    const b = store.create({ ...first, title: 'Hook' });
    expect(a).toEqual({
      id: 'm1',
      title: 'Phone stand',
      request: 'Phone stand, 80 mm wide',
      versions: [{ v: 1, code: 'width = 80;', label: 'First version', at: 1001, model: 'gemini-3.1-flash-lite' }],
      current: 1,
    });
    expect(store.list().map((model) => model.id)).toEqual([b.id, a.id]);
    expect(store.get('m1')).toBe(a);
    expect(store.get('nope')).toBeUndefined();
  });

  it('adds versions and moves between them with undo, redo and select', () => {
    const { store } = setup();
    const { id } = store.create(first);
    store.addVersion(id, { code: 'width = 90;', label: 'Make it 10 mm wider', model: 'gemini-3-flash-preview' });
    let model = store.addVersion(id, { code: 'width = 100;', label: 'Wider again' })!;
    expect(model.versions.map((version) => version.v)).toEqual([1, 2, 3]);
    expect(model.current).toBe(3);
    expect(currentVersion(model).code).toBe('width = 100;');

    expect(store.undo(id)!.current).toBe(2);
    expect(store.undo(id)!.current).toBe(1);
    expect(store.undo(id)!.current).toBe(1);
    expect(store.redo(id)!.current).toBe(2);
    expect(store.select(id, 3)!.current).toBe(3);
    expect(store.redo(id)!.current).toBe(3);
    expect(store.select(id, 9)!.current).toBe(3);

    // a change made on an older version is added at the end; nothing is dropped
    store.select(id, 1);
    model = store.addVersion(id, { code: 'width = 70;', label: 'Narrower' })!;
    expect(model.versions.map((version) => version.label)).toEqual([
      'First version',
      'Make it 10 mm wider',
      'Wider again',
      'Narrower',
    ]);
    expect(model.current).toBe(4);
  });

  it('keeps the same object when nothing changes, and tells listeners only about real changes', () => {
    const { store } = setup();
    const { id } = store.create(first);
    let calls = 0;
    const stop = store.subscribe(() => (calls += 1));
    const before = store.get(id);
    expect(store.undo(id)).toBe(before);
    expect(calls).toBe(0);
    store.addVersion(id, { code: 'width = 90;', label: 'Wider' });
    expect(calls).toBe(1);
    expect(store.get(id)).not.toBe(before);
    stop();
    store.undo(id);
    expect(calls).toBe(1);
    expect(store.addVersion('missing', { code: '', label: '' })).toBeUndefined();
  });

  it('mirrors parts to session storage so a reload keeps them', () => {
    const storage = memoryStorage();
    const { store } = setup(storage);
    const { id } = store.create(first);
    store.addVersion(id, { code: 'width = 90;', label: 'Wider' });
    store.undo(id);

    const reloaded = setup(storage).store;
    const model = reloaded.get(id)!;
    expect(model.versions).toHaveLength(2);
    expect(model.current).toBe(1);
    expect(JSON.parse(storage.data.get(STORAGE_KEY)!)).toHaveLength(1);
  });

  it('drops damaged entries from storage instead of failing', () => {
    const good = { id: 'ok', title: 'A', request: 'a', versions: [{ v: 1, code: 'x = 1;', label: 'First', at: 1 }], current: 7 };
    const bad = [
      null,
      { id: 'no-versions', title: 'B', request: 'b', versions: [] },
      { id: 'gap', title: 'C', request: 'c', versions: [{ v: 2, code: '', label: '', at: 1 }], current: 1 },
      { id: 3, title: 'D' },
    ];
    const storage = memoryStorage({ [STORAGE_KEY]: JSON.stringify([good, ...bad]) });
    const { store } = setup(storage);
    expect(store.list().map((model) => model.id)).toEqual(['ok']);
    // a current version out of range falls back to the newest
    expect(store.get('ok')!.current).toBe(1);

    expect(setup(memoryStorage({ [STORAGE_KEY]: 'not json' })).store.list()).toEqual([]);
  });

  it('works in memory when storage is missing or throws', () => {
    const { store } = setup(null);
    const { id } = store.create(first);
    expect(store.addVersion(id, { code: 'width = 90;', label: 'Wider' })!.current).toBe(2);

    const throwing = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('full');
      },
    };
    const other = createModelStore({ getStorage: () => throwing });
    const saved = other.create(first);
    expect(other.get(saved.id)).toBe(saved);
    expect(saved.id).toMatch(/^[a-z0-9]{6,}$/);
  });

  it('never reuses an id that is taken', () => {
    const ids = ['same', 'same', 'other'];
    const store = createModelStore({ getStorage: () => null, makeId: () => ids.shift()! });
    expect(store.create(first).id).toBe('same');
    expect(store.create(first).id).toBe('other');
  });
});
