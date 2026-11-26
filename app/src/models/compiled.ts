import type { Shown } from '../part/liveCompile';

const MAX = 40;
const cache = new Map<string, Shown>();

// Models already compiled in this tab, by their code, so moving between versions needs no new compile.
export const compiledModels = {
  get: (code: string) => cache.get(code),
  set(code: string, shown: Shown) {
    cache.delete(code);
    cache.set(code, shown);
    for (const oldest of cache.keys()) {
      if (cache.size <= MAX) break;
      cache.delete(oldest);
    }
  },
};
