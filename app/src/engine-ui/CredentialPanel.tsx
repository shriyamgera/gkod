import type { EngineId } from '../engine';
import { KeyPanel } from './KeyPanel';
import { PairingPanel } from './PairingPanel';

type Props = {
  engine: EngineId;
  // for Gemini, e.g. "Fix it for me uses your own free Gemini key"
  keyTitle?: string;
  message?: string;
  onSet: () => void;
  onCancel: () => void;
  className?: string;
};

// What an engine needs before it can run: the visitor's Gemini key, or the pairing code of the bridge on this Mac.
export function CredentialPanel({ engine, keyTitle = 'GKod uses your own free Gemini key', message, onSet, onCancel, className = 'key-inline' }: Props) {
  if (engine === 'claude-code') {
    return (
      <section className={className} aria-label="Pairing code">
        <PairingPanel title="Pair with the bridge on this Mac" message={message} autoFocus onCodeSet={onSet} onCancel={onCancel} />
      </section>
    );
  }
  return (
    <section className={className} aria-label="Gemini key">
      <KeyPanel title={keyTitle} message={message} autoFocus onKeySet={onSet} onCancel={onCancel} />
    </section>
  );
}
