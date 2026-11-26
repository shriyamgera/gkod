import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type Choice = typeof import('./printerChoice');

function fakeStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => void data.set(key, value),
    data,
  };
}

async function fresh(): Promise<Choice> {
  vi.resetModules();
  return import('./printerChoice');
}

beforeEach(() => {
  vi.unstubAllGlobals();
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe('printer choice', () => {
  it('starts with the Kobra 2 Neo when nothing is stored, or storage is missing', async () => {
    const choice = await fresh();
    expect(choice.getPrinterId()).toBe('anycubic-kobra-2-neo');
    expect(choice.getPrinter().name).toBe('Anycubic Kobra 2 Neo');
  });

  it('remembers the chosen printer on this device', async () => {
    const storage = fakeStorage();
    vi.stubGlobal('localStorage', storage);
    const choice = await fresh();
    choice.setPrinterId('creality-ender-3-v2');
    expect(storage.data.get('gkod.printer')).toBe('creality-ender-3-v2');
    const later = await fresh();
    expect(later.getPrinterId()).toBe('creality-ender-3-v2');
  });

  it('ignores a stored or chosen id that is not in the list', async () => {
    vi.stubGlobal('localStorage', fakeStorage({ 'gkod.printer': 'bambu-lab-x1' }));
    const choice = await fresh();
    expect(choice.getPrinterId()).toBe('anycubic-kobra-2-neo');
    choice.setPrinterId('no-such-printer');
    expect(choice.getPrinterId()).toBe('anycubic-kobra-2-neo');
  });

  it('keeps working when storage throws', async () => {
    vi.stubGlobal('localStorage', {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
    });
    const choice = await fresh();
    expect(choice.getPrinterId()).toBe('anycubic-kobra-2-neo');
    choice.setPrinterId('anycubic-kobra-2');
    expect(choice.getPrinterId()).toBe('anycubic-kobra-2');
  });

  it('tells subscribers about a change until they unsubscribe', async () => {
    const choice = await fresh();
    const seen: string[] = [];
    const stop = choice.subscribePrinterId((id) => seen.push(id));
    choice.setPrinterId('anycubic-kobra-2');
    choice.setPrinterId('anycubic-kobra-2');
    stop();
    choice.setPrinterId('other-220-marlin');
    expect(seen).toEqual(['anycubic-kobra-2']);
  });
});
