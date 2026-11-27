import { describe, expect, it, vi } from 'vitest';
import { createBridgeStatus, fetchHealth, SEEN_KEY } from './bridge';
import { forgetTurnedDown, needsCredential } from './engines';
import { createKeyStore, createPairingStore, PAIRING_STORAGE_KEY, pairingStore, STORAGE_KEY } from './keyStore';
import { createSettings, DEFAULT_CLAUDE_MODEL, DEFAULT_MODEL, ENGINE_STORAGE_KEY } from './settings';

class FakeStorage {
  items = new Map<string, string>();
  getItem = (key: string) => this.items.get(key) ?? null;
  setItem = (key: string, value: string) => void this.items.set(key, value);
  removeItem = (key: string) => void this.items.delete(key);
}

const health = { ok: true, bridge: '0.1.0', claude_found: true, claude_version: '2.1.276', logged_in: true, busy: false };
const answering = (body: unknown = health) => vi.fn(async () => new Response(JSON.stringify(body))) as unknown as typeof fetch;
const silent = vi.fn(async () => {
  throw new TypeError('Failed to fetch');
}) as unknown as typeof fetch;

describe('engine settings', () => {
  it('starts on Gemini with each engine’s default model', () => {
    const settings = createSettings();
    expect(settings.engine()).toBe('gemini');
    expect(settings.model()).toBe(DEFAULT_MODEL);
    expect(settings.model('claude-code')).toBe(DEFAULT_CLAUDE_MODEL);
  });

  it('keeps a model per engine and the engine for this tab', () => {
    const storage = new FakeStorage();
    const settings = createSettings(() => storage);
    const listener = vi.fn();
    settings.subscribe(listener);
    settings.setEngine('claude-code');
    settings.setModel('opus', 'claude-code');
    expect(settings.model('claude-code')).toBe('opus');
    expect(settings.model()).toBe(DEFAULT_MODEL);
    expect(listener).toHaveBeenCalledTimes(2);
    expect(storage.items.get(ENGINE_STORAGE_KEY)).toBe('claude-code');
    expect(createSettings(() => storage).engine()).toBe('claude-code');
  });

  it('ignores a damaged saved engine and storage that throws', () => {
    const storage = new FakeStorage();
    storage.items.set(ENGINE_STORAGE_KEY, 'something-else');
    expect(createSettings(() => storage).engine()).toBe('gemini');
    const throwing = createSettings(() => {
      throw new Error('SecurityError');
    });
    throwing.setEngine('claude-code');
    expect(throwing.engine()).toBe('claude-code');
  });
});

describe('pairing code store', () => {
  it('is kept apart from the Gemini key', () => {
    const storage = new FakeStorage();
    const key = createKeyStore(() => storage);
    const code = createKeyStore(() => storage, PAIRING_STORAGE_KEY);
    key.set('AQ.test-key-1234567890', true);
    code.set('ABCD-EFGH-JKMN', true);
    expect(storage.items.get(STORAGE_KEY)).toBe('AQ.test-key-1234567890');
    expect(storage.items.get(PAIRING_STORAGE_KEY)).toBe('ABCD-EFGH-JKMN');
    code.forget();
    expect(key.get()).toBe('AQ.test-key-1234567890');
    expect(storage.items.has(PAIRING_STORAGE_KEY)).toBe(false);
  });

  it('is in memory only unless remembered', () => {
    const storage = new FakeStorage();
    const code = createKeyStore(() => storage, PAIRING_STORAGE_KEY);
    code.set('ABCD-EFGH-JKMN', false);
    expect(code.get()).toBe('ABCD-EFGH-JKMN');
    expect(storage.items.size).toBe(0);
  });

  it('is remembered in this tab only, never in the storage other pages on the address share', () => {
    const tab = new FakeStorage();
    const shared = new FakeStorage();
    const code = createPairingStore(() => tab, () => shared);
    code.set('ABCD-EFGH-JKMN', true);
    expect(code.isRemembered()).toBe(true);
    expect(tab.items.get(PAIRING_STORAGE_KEY)).toBe('ABCD-EFGH-JKMN');
    expect(shared.items.size).toBe(0);
    // a reload in the same tab finds it again
    expect(createPairingStore(() => tab, () => shared).get()).toBe('ABCD-EFGH-JKMN');
  });

  it('takes out a code an earlier version saved on the device, and leaves the Gemini key', () => {
    const tab = new FakeStorage();
    const shared = new FakeStorage();
    shared.items.set(PAIRING_STORAGE_KEY, 'ABCD-EFGH-JKMN');
    shared.items.set(STORAGE_KEY, 'AQ.test-key-1234567890');
    const code = createPairingStore(() => tab, () => shared);
    expect(code.get()).toBeNull();
    expect(shared.items.has(PAIRING_STORAGE_KEY)).toBe(false);
    expect(shared.items.get(STORAGE_KEY)).toBe('AQ.test-key-1234567890');
  });

  it('works when storage throws', () => {
    const blocked = () => {
      throw new Error('SecurityError');
    };
    const code = createPairingStore(blocked, blocked);
    code.set('ABCD-EFGH-JKMN', true);
    expect(code.get()).toBe('ABCD-EFGH-JKMN');
    expect(code.isRemembered()).toBe(false);
  });
});

describe('credentials', () => {
  it('knows which problems need a key or a code', () => {
    expect(['no-key', 'bad-key', 'no-pairing', 'bad-pairing'].every((p) => needsCredential(p as never))).toBe(true);
    expect(needsCredential('busy')).toBe(false);
    expect(needsCredential('no-bridge')).toBe(false);
  });

  it('forgets a pairing code the bridge turned down', () => {
    pairingStore.set('ABCD-EFGH-JKMN', false);
    forgetTurnedDown('bad-pairing');
    expect(pairingStore.get()).toBeNull();
  });
});

describe('looking for the bridge', () => {
  it('reads the health answer', async () => {
    expect(await fetchHealth(answering(), 'http://bridge.test')).toEqual({
      claudeFound: true,
      claudeVersion: '2.1.276',
      loggedIn: true,
      toolsFound: null,
      busy: false,
    });
    expect((await fetchHealth(answering({ ...health, tools_found: false }), 'http://bridge.test'))?.toolsFound).toBe(false);
    expect((await fetchHealth(answering({ ...health, tools_found: true }), 'http://bridge.test'))?.toolsFound).toBe(true);
  });

  it('counts no answer, an error or a strange answer as no bridge', async () => {
    expect(await fetchHealth(silent, 'http://bridge.test')).toBeNull();
    expect(await fetchHealth(answering({ hello: 1 }), 'http://bridge.test')).toBeNull();
    const failing = vi.fn(async () => new Response('nope', { status: 500 })) as unknown as typeof fetch;
    expect(await fetchHealth(failing, 'http://bridge.test')).toBeNull();
  });

  it('on the public site only looks on its own once the bridge was found in this browser', async () => {
    const storage = new FakeStorage();
    const status = createBridgeStatus({ fetch: answering(), getStorage: () => storage, isLocalPage: () => false });
    expect(status.mayLookOnItsOwn()).toBe(false);
    expect(status.snapshot()).toEqual({ status: 'unknown' });
    const found = await status.check();
    expect(found.status).toBe('found');
    expect(storage.items.get(SEEN_KEY)).toBe('1');
    expect(status.mayLookOnItsOwn()).toBe(true);
    status.forgetSeen();
    expect(status.mayLookOnItsOwn()).toBe(false);
  });

  it('looks on its own on this computer’s own pages, and says when nothing answers', async () => {
    const status = createBridgeStatus({ fetch: silent, getStorage: () => new FakeStorage(), isLocalPage: () => true });
    expect(status.mayLookOnItsOwn()).toBe(true);
    const listener = vi.fn();
    status.subscribe(listener);
    expect((await status.check()).status).toBe('absent');
    // checking, then absent
    expect(listener).toHaveBeenCalledTimes(2);
  });
});
