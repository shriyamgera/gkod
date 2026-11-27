import { bridgeStatus } from './bridge';
import { claudeCode } from './claudeCode';
import { gemini } from './gemini';
import { keyStore, pairingStore } from './keyStore';
import { engineSettings } from './settings';
import type { Engine, EngineId, EngineProblem } from './types';

export const ENGINES: Record<EngineId, Engine> = { gemini, 'claude-code': claudeCode };

// The names on the Engine menu.
export const ENGINE_CHOICES: { id: EngineId; label: string }[] = [
  { id: 'gemini', label: 'Gemini (your key)' },
  { id: 'claude-code', label: 'Claude Code (on this Mac)' },
];

export function currentEngine(): Engine {
  return ENGINES[engineSettings.engine()];
}

// Gemini needs the visitor's key; Claude Code needs the bridge's pairing code.
export function engineReady(id: EngineId): boolean {
  return Boolean(id === 'claude-code' ? pairingStore.get() : keyStore.get());
}

export function needsCredential(problem: EngineProblem | 'compile'): problem is 'no-key' | 'bad-key' | 'no-pairing' | 'bad-pairing' {
  return problem === 'no-key' || problem === 'bad-key' || problem === 'no-pairing' || problem === 'bad-pairing';
}

// A key Google turned down, or a code the bridge turned down, is not kept, so it is not sent again.
export function forgetTurnedDown(problem: EngineProblem | 'compile') {
  if (problem === 'bad-key') keyStore.forget();
  if (problem === 'bad-pairing') pairingStore.forget();
  // the bridge may have stopped since it was found
  if (problem === 'no-bridge') void bridgeStatus.check();
}
