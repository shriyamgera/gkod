import { useSyncExternalStore } from 'react';

// The GKod bridge runs Claude Code on the owner's own Mac and answers only on this address (see bridge/).
export const BRIDGE_URL = 'http://127.0.0.1:8765';
export const SEEN_KEY = 'gkod.bridgeSeen';
const HEALTH_TIMEOUT_MS = 2500;

// toolsFound: whether the bridge has GKod's MCP tools to test the part with (null: an answer that does not say)
export type BridgeHealth = {
  claudeFound: boolean;
  claudeVersion: string | null;
  loggedIn: boolean | null;
  toolsFound: boolean | null;
  busy: boolean;
};

export type BridgeState =
  | { status: 'unknown' | 'checking' | 'absent' }
  | { status: 'found'; health: BridgeHealth };

type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

function attempt<T>(action: () => T, fallback: T): T {
  try {
    return action();
  } catch {
    return fallback;
  }
}

// GET /health needs no pairing code. Anything but a well-formed answer counts as no bridge.
export async function fetchHealth(
  send: typeof fetch = (input, init) => globalThis.fetch(input, init),
  base = BRIDGE_URL,
  timeoutMs = HEALTH_TIMEOUT_MS,
): Promise<BridgeHealth | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await send(`${base}/health`, { signal: controller.signal, cache: 'no-store' });
    if (!response.ok) return null;
    const data = (await response.json()) as Record<string, unknown> | null;
    if (!data || data.ok !== true) return null;
    return {
      claudeFound: data.claude_found === true,
      claudeVersion: typeof data.claude_version === 'string' ? data.claude_version : null,
      loggedIn: typeof data.logged_in === 'boolean' ? data.logged_in : null,
      toolsFound: typeof data.tools_found === 'boolean' ? data.tools_found : null,
      busy: data.busy === true,
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

type Deps = {
  fetch?: typeof fetch;
  getStorage?: () => StorageLike | null;
  // a page served from this computer may look for the bridge at once; the public site only once asked
  isLocalPage?: () => boolean;
  base?: string;
};

const localPage = () =>
  typeof window !== 'undefined' && ['localhost', '127.0.0.1'].includes(window.location.hostname);

// Whether the bridge answers on this computer. The public site does not look for it on its own: in Chrome a public
// page that calls this computer's address first asks the visitor for permission, so it only looks when the visitor
// asks, or once the bridge has been found in this browser before.
export function createBridgeStatus({ fetch: send, getStorage = () => null, isLocalPage = localPage, base = BRIDGE_URL }: Deps = {}) {
  const listeners = new Set<() => void>();
  let state: BridgeState = { status: 'unknown' };
  let running: Promise<BridgeState> | null = null;

  function update(next: BridgeState) {
    state = next;
    listeners.forEach((listener) => listener());
  }

  async function check(): Promise<BridgeState> {
    if (running) return running;
    update({ status: 'checking' });
    running = (async () => {
      const health = await fetchHealth(send, base);
      const next: BridgeState = health ? { status: 'found', health } : { status: 'absent' };
      if (health) attempt(() => getStorage()?.setItem(SEEN_KEY, '1'), undefined);
      update(next);
      running = null;
      return next;
    })();
    return running;
  }

  return {
    snapshot: () => state,
    check,
    mayLookOnItsOwn: () => isLocalPage() || attempt(() => getStorage()?.getItem(SEEN_KEY) === '1', false),
    // after the pairing code is forgotten, the public site no longer looks for the bridge on its own
    forgetSeen: () => attempt(() => getStorage()?.removeItem(SEEN_KEY), undefined),
    subscribe(fn: () => void) {
      listeners.add(fn);
      return () => {
        listeners.delete(fn);
      };
    },
  };
}

export const bridgeStatus = createBridgeStatus({
  getStorage: () => (typeof window === 'undefined' ? null : window.localStorage),
});

export function useBridgeStatus(): BridgeState {
  return useSyncExternalStore(bridgeStatus.subscribe, bridgeStatus.snapshot, bridgeStatus.snapshot);
}
