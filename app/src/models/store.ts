import { useSyncExternalStore } from 'react';

// supports: the visitor chose to print this version with supports instead of fixing its overhang
export type ModelVersion = { v: number; code: string; label: string; at: number; model?: string; supports?: boolean };

// current is the v of the version on screen. Versions are never dropped: a change made while an older
// version is shown is added at the end, so undo and redo simply step through the list.
// session: the latest Claude Code session that worked on the part, so the next change with Claude Code continues it
export type SavedModel = { id: string; title: string; request: string; versions: ModelVersion[]; current: number; session?: string };

export type NewModel = { title: string; request: string; code: string; label: string; model?: string; session?: string };
export type NewVersion = { code: string; label: string; model?: string; session?: string };

const SESSION = /^[0-9a-f-]{36}$/i;
const sessionOf = (value: unknown) => (isText(value) && SESSION.test(value) ? { session: value } : {});

export const STORAGE_KEY = 'gkod.models';
const MAX_MODELS = 30;

type StorageLike = Pick<Storage, 'getItem' | 'setItem'>;

type Deps = {
  getStorage: () => StorageLike | null;
  now?: () => number;
  makeId?: () => string;
};

function attempt<T>(action: () => T, fallback: T): T {
  try {
    return action();
  } catch {
    return fallback;
  }
}

function randomId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(6));
  return Array.from(bytes, (byte) => byte.toString(36).padStart(2, '0')).join('');
}

const isText = (value: unknown): value is string => typeof value === 'string';

function readVersion(value: unknown): ModelVersion | null {
  const v = value as Partial<ModelVersion> | null;
  if (!v || typeof v.v !== 'number' || !isText(v.code) || !isText(v.label) || typeof v.at !== 'number') return null;
  return {
    v: v.v,
    code: v.code,
    label: v.label,
    at: v.at,
    ...(isText(v.model) ? { model: v.model } : {}),
    ...(v.supports === true ? { supports: true } : {}),
  };
}

// What comes back from storage is checked, so a damaged entry is dropped instead of breaking the page.
function readModel(value: unknown): SavedModel | null {
  const m = value as Partial<SavedModel> | null;
  if (!m || !isText(m.id) || !isText(m.title) || !isText(m.request) || !Array.isArray(m.versions)) return null;
  const versions = m.versions.map(readVersion);
  if (versions.length === 0 || versions.some((version, i) => !version || version.v !== i + 1)) return null;
  const current = typeof m.current === 'number' && m.current >= 1 && m.current <= versions.length ? m.current : versions.length;
  return { id: m.id, title: m.title, request: m.request, versions: versions as ModelVersion[], current, ...sessionOf(m.session) };
}

// Parts made in this tab. They are kept in memory and copied to sessionStorage, so a reload keeps them
// and closing the tab ends them. Every object is replaced on change, so React can compare by reference.
export function createModelStore({ getStorage, now = Date.now, makeId = randomId }: Deps) {
  const listeners = new Set<() => void>();
  let models: SavedModel[] | null = null;

  const storage = () => attempt(getStorage, null);

  function all(): SavedModel[] {
    if (!models) {
      const saved = attempt(() => JSON.parse(storage()?.getItem(STORAGE_KEY) ?? '[]') as unknown, []);
      models = Array.isArray(saved) ? saved.map(readModel).filter((model) => model !== null) : [];
    }
    return models;
  }

  // a full storage only costs the copy; the parts stay in memory
  function commit(next: SavedModel[]) {
    models = next;
    attempt(() => storage()?.setItem(STORAGE_KEY, JSON.stringify(next)), undefined);
    listeners.forEach((listener) => listener());
  }

  function replace(id: string, change: (model: SavedModel) => SavedModel): SavedModel | undefined {
    const model = get(id);
    if (!model) return undefined;
    const next = change(model);
    if (next !== model) commit(all().map((item) => (item.id === id ? next : item)));
    return next;
  }

  function get(id: string): SavedModel | undefined {
    return all().find((model) => model.id === id);
  }

  function create({ title, request, code, label, model, session }: NewModel): SavedModel {
    let id = makeId();
    while (get(id)) id = makeId();
    const first: ModelVersion = { v: 1, code, label, at: now(), ...(model ? { model } : {}) };
    const saved: SavedModel = { id, title, request, versions: [first], current: 1, ...sessionOf(session) };
    commit([saved, ...all()].slice(0, MAX_MODELS));
    return saved;
  }

  function addVersion(id: string, { code, label, model, session }: NewVersion): SavedModel | undefined {
    return replace(id, (saved) => {
      const v = saved.versions.length + 1;
      const version: ModelVersion = { v, code, label, at: now(), ...(model ? { model } : {}) };
      return { ...saved, versions: [...saved.versions, version], current: v, ...sessionOf(session) };
    });
  }

  function select(id: string, v: number): SavedModel | undefined {
    return replace(id, (saved) =>
      v === saved.current || v < 1 || v > saved.versions.length ? saved : { ...saved, current: v },
    );
  }

  // The choice belongs to one version, so undo and redo show each version with its own choice.
  function setSupports(id: string, v: number, on: boolean): SavedModel | undefined {
    return replace(id, (saved) => {
      const version = saved.versions[v - 1];
      if (!version || (version.supports === true) === on) return saved;
      const { supports: _, ...rest } = version;
      const next: ModelVersion = on ? { ...rest, supports: true } : rest;
      return { ...saved, versions: saved.versions.map((item) => (item.v === v ? next : item)) };
    });
  }

  return {
    get,
    list: all,
    create,
    addVersion,
    select,
    setSupports,
    undo: (id: string) => replace(id, (saved) => (saved.current > 1 ? { ...saved, current: saved.current - 1 } : saved)),
    redo: (id: string) =>
      replace(id, (saved) => (saved.current < saved.versions.length ? { ...saved, current: saved.current + 1 } : saved)),
    subscribe(fn: () => void) {
      listeners.add(fn);
      return () => {
        listeners.delete(fn);
      };
    },
  };
}

export const modelStore = createModelStore({
  getStorage: () => (typeof window === 'undefined' ? null : window.sessionStorage),
});

export function currentVersion(model: SavedModel): ModelVersion {
  return model.versions[model.current - 1] ?? model.versions[model.versions.length - 1]!;
}

export function useSavedModel(id: string): SavedModel | undefined {
  const read = () => modelStore.get(id);
  return useSyncExternalStore(modelStore.subscribe, read, read);
}
