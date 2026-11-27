import { type FormEvent, type KeyboardEvent, useEffect, useId, useRef, useState } from 'react';
import { bridgeStatus, pairingStore, usePairingCode } from '../engine';
import { NOT_REMEMBERED_CODE, pairingProblem, pairingRememberMessage } from './rules';
import './engine-ui.css';

type Props = {
  title: string;
  titleAs?: 'h2' | 'h3';
  // shown above the field, e.g. when the bridge turned the code down
  message?: string;
  autoFocus?: boolean;
  onCodeSet?: () => void;
  onCancel?: () => void;
};

// The pairing code the bridge prints in its terminal. Kept in memory, or, when "Keep" is ticked, in this tab's own
// storage until the tab is closed. Never on the device: other pages on the same web address could read it there.
export function PairingPanel({ title, titleAs: Title = 'h2', message, autoFocus = false, onCodeSet, onCancel }: Props) {
  const { key: code, remembered } = usePairingCode();
  const [input, setInput] = useState('');
  const [remember, setRemember] = useState(remembered);
  const [rememberFailed, setRememberFailed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [said, setSaid] = useState('');
  const field = useRef<HTMLInputElement>(null);
  const id = useId();

  useEffect(() => {
    if (autoFocus) field.current?.focus();
  }, [autoFocus]);

  function showRemembered(change: 'new-code' | 'box', asked: boolean) {
    const done = pairingStore.isRemembered();
    setRemember(done);
    setRememberFailed(asked && !done);
    setSaid(pairingRememberMessage(change, asked, done));
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    const problem = pairingProblem(input);
    if (problem) {
      setError(problem);
      field.current?.focus();
      return;
    }
    pairingStore.set(input.trim().toUpperCase(), remember);
    setInput('');
    setError(null);
    showRemembered('new-code', remember);
    onCodeSet?.();
  }

  function changeRemember(next: boolean) {
    setRemember(next);
    setRememberFailed(false);
    if (code && !input.trim()) {
      pairingStore.set(code, next);
      showRemembered('box', next);
    }
  }

  function forget() {
    pairingStore.forget();
    bridgeStatus.forgetSeen();
    setRemember(false);
    setRememberFailed(false);
    setSaid('Pairing code forgotten');
    field.current?.focus();
  }

  function onKeyDown(event: KeyboardEvent) {
    if (event.key === 'Escape' && onCancel) {
      event.preventDefault();
      onCancel();
    }
  }

  const describedBy = [message ? `${id}-message` : null, error ? `${id}-error` : null, `${id}-privacy`].filter(Boolean).join(' ');

  return (
    <form className="key-panel" onSubmit={submit} onKeyDown={onKeyDown} noValidate>
      <Title className="key-title">{title}</Title>
      {message && (
        <p id={`${id}-message`} className="key-message">
          {message}
        </p>
      )}
      {code && <p className="key-hint mono">Paired with the bridge</p>}

      <div className="key-field">
        <label htmlFor={`${id}-code`}>{code ? 'Use a different pairing code' : 'Pairing code'}</label>
        <div className="key-row">
          <input
            ref={field}
            id={`${id}-code`}
            type="text"
            className="mono"
            value={input}
            onChange={(event) => setInput(event.target.value)}
            placeholder="ABCD-EFGH-JKMN"
            autoComplete="off"
            autoCapitalize="characters"
            autoCorrect="off"
            spellCheck={false}
            aria-invalid={error ? true : undefined}
            aria-describedby={describedBy}
          />
        </div>
        {error && (
          <p id={`${id}-error`} className="key-error">
            {error}
          </p>
        )}
      </div>

      <div className="key-remember">
        <input
          type="checkbox"
          id={`${id}-remember`}
          checked={remember}
          onChange={(event) => changeRemember(event.target.checked)}
          aria-describedby={`${id}-remember-help`}
        />
        <label htmlFor={`${id}-remember`}>Keep it until I close this tab</label>
        <p id={`${id}-remember-help`} className="muted">
          It stays through a reload. It is never saved on the device, because other pages on this web address could
          read it there.
        </p>
        {rememberFailed && <p>{NOT_REMEMBERED_CODE}</p>}
      </div>

      <div className="key-actions">
        <button type="submit" className="eu-main">
          Use code
        </button>
        {code && (
          <button type="button" className="eu-quiet" onClick={forget}>
            Forget code
          </button>
        )}
        {onCancel && (
          <button type="button" className="eu-quiet" onClick={onCancel}>
            Not now
          </button>
        )}
      </div>

      <p id={`${id}-privacy`} className="key-privacy muted">
        The bridge shows the code in its terminal when it starts. It stays in this tab and is sent only to the bridge
        on this Mac.
      </p>
      <p role="status" className="visually-hidden">
        {said}
      </p>
    </form>
  );
}
