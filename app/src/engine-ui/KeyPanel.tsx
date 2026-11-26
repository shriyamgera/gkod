import { type FormEvent, type KeyboardEvent, useEffect, useId, useRef, useState } from 'react';
import { keyStore, useGeminiKey } from '../engine';
import { keyHint, keyProblem, NOT_REMEMBERED, rememberMessage } from './rules';
import './engine-ui.css';

export const KEY_PAGE = 'https://aistudio.google.com/apikey';

type Props = {
  title: string;
  titleAs?: 'h2' | 'h3';
  // shown above the field, e.g. when Google turned the key down
  message?: string;
  autoFocus?: boolean;
  onKeySet?: () => void;
  onCancel?: () => void;
};

export function KeyPanel({ title, titleAs: Title = 'h2', message, autoFocus = false, onKeySet, onCancel }: Props) {
  const { key, remembered } = useGeminiKey();
  const [input, setInput] = useState('');
  const [show, setShow] = useState(false);
  const [remember, setRemember] = useState(remembered);
  // ticked, but the browser would not store the key
  const [rememberFailed, setRememberFailed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [said, setSaid] = useState('');
  const field = useRef<HTMLInputElement>(null);
  const id = useId();

  useEffect(() => {
    if (autoFocus) field.current?.focus();
  }, [autoFocus]);

  function submit(event: FormEvent) {
    event.preventDefault();
    const problem = keyProblem(input);
    if (problem) {
      setError(problem);
      field.current?.focus();
      return;
    }
    keyStore.set(input.trim(), remember);
    setInput('');
    setShow(false);
    setError(null);
    showRemembered('new-key', remember);
    onKeySet?.();
  }

  // The box and the message follow what the store did, since storage can refuse the key.
  function showRemembered(change: 'new-key' | 'box', asked: boolean) {
    const done = keyStore.isRemembered();
    setRemember(done);
    setRememberFailed(asked && !done);
    setSaid(rememberMessage(change, asked, done));
  }

  // With a key already set and nothing typed, the box applies at once.
  function changeRemember(next: boolean) {
    setRemember(next);
    setRememberFailed(false);
    if (key && !input.trim()) {
      keyStore.set(key, next);
      showRemembered('box', next);
    }
  }

  function forget() {
    keyStore.forget();
    setRemember(false);
    setRememberFailed(false);
    setSaid('Key forgotten');
    field.current?.focus();
  }

  function onKeyDown(event: KeyboardEvent) {
    if (event.key === 'Escape' && onCancel) {
      event.preventDefault();
      onCancel();
    }
  }

  // the reason the panel opened is read out first when the field gets focus
  const describedBy = [message ? `${id}-message` : null, error ? `${id}-error` : null, `${id}-privacy`].filter(Boolean).join(' ');

  return (
    <form className="key-panel" onSubmit={submit} onKeyDown={onKeyDown} noValidate>
      <Title className="key-title">{title}</Title>
      {message && (
        <p id={`${id}-message`} className="key-message">
          {message}
        </p>
      )}
      {key && <p className="key-hint mono">{keyHint(key)}</p>}

      <div className="key-field">
        <label htmlFor={`${id}-key`}>{key ? 'Use a different key' : 'Your Gemini key'}</label>
        <div className="key-row">
          <input
            ref={field}
            id={`${id}-key`}
            type={show ? 'text' : 'password'}
            value={input}
            onChange={(event) => setInput(event.target.value)}
            autoComplete="off"
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
            aria-invalid={error ? true : undefined}
            aria-describedby={describedBy}
          />
          <button type="button" className="eu-quiet key-show" onClick={() => setShow(!show)}>
            {show ? 'Hide' : 'Show'}
            <span className="visually-hidden"> key</span>
          </button>
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
        <label htmlFor={`${id}-remember`}>Remember on this device</label>
        <p id={`${id}-remember-help`} className="muted">
          Only tick this on your own computer.
        </p>
        {rememberFailed && <p>{NOT_REMEMBERED}</p>}
      </div>

      <div className="key-actions">
        <button type="submit" className="eu-main">
          Use key
        </button>
        {key && (
          <button type="button" className="eu-quiet" onClick={forget}>
            Forget key
          </button>
        )}
        {onCancel && (
          <button type="button" className="eu-quiet" onClick={onCancel}>
            Not now
          </button>
        )}
      </div>

      <p className="key-get">
        <a href={KEY_PAGE} target="_blank" rel="noopener noreferrer">
          Get a free key from Google AI Studio
          <span className="visually-hidden"> (opens in a new tab)</span>
        </a>
      </p>
      <p id={`${id}-privacy`} className="key-privacy muted">
        Stays in this browser. Never on a server, never in a link.
      </p>
      <p role="status" className="visually-hidden">
        {said}
      </p>
    </form>
  );
}
