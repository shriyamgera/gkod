import { type KeyboardEvent, type MouseEvent, useEffect, useId, useRef, useSyncExternalStore } from 'react';
import { engineSettings, gemini, keyStore } from '../engine';
import { KeyPanel } from './KeyPanel';
import './engine-ui.css';

type Props = { open: boolean; onClose: () => void };

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]):not([type="radio"]), input[type="radio"]:checked';

export function EngineDialog({ open, onClose }: Props) {
  const dialog = useRef<HTMLDialogElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const opener = useRef<HTMLElement | null>(null);
  const titleId = useId();

  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    if (open && !element.open) {
      opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      element.showModal();
      // with no key yet the field is what the visitor came for; otherwise the title is read first
      const field = element.querySelector<HTMLInputElement>('input[type="password"]');
      if (!keyStore.get() && field) field.focus();
      else heading.current?.focus();
    } else if (!open && element.open) {
      element.close();
    }
  }, [open]);

  function onDialogClose() {
    onClose();
    opener.current?.focus();
    opener.current = null;
  }

  // a click on the dimmed backdrop lands on the dialog itself, not on its content
  function onClick(event: MouseEvent<HTMLDialogElement>) {
    if (event.target === event.currentTarget) dialog.current?.close();
  }

  // Tab and Shift+Tab wrap around inside the dialog instead of leaving for the browser's own controls.
  function onKeyDown(event: KeyboardEvent<HTMLDialogElement>) {
    if (event.key !== 'Tab' || !dialog.current) return;
    const items = Array.from(dialog.current.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
      (item) => item.offsetParent !== null || item === document.activeElement,
    );
    const first = items[0];
    const last = items[items.length - 1];
    if (!first || !last) return;
    const active = document.activeElement;
    if (event.shiftKey && (active === first || active === heading.current)) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && active === last) {
      event.preventDefault();
      first.focus();
    }
  }

  return (
    <dialog
      ref={dialog}
      className="engine-dialog"
      aria-labelledby={titleId}
      onClose={onDialogClose}
      onClick={onClick}
      onKeyDown={onKeyDown}
    >
      {open && (
        <div className="engine-dialog-body">
          <div className="engine-dialog-head">
            <h2 id={titleId} ref={heading} tabIndex={-1}>
              Engine
            </h2>
            <button type="button" className="eu-quiet engine-close" onClick={() => dialog.current?.close()}>
              Close
            </button>
          </div>
          <KeyPanel title="GKod uses your own free Gemini key" titleAs="h3" />
          <ModelMenu />
        </div>
      )}
    </dialog>
  );
}

function ModelMenu() {
  const chosen = useSyncExternalStore(engineSettings.subscribe, engineSettings.model);
  const id = useId();
  return (
    <fieldset className="model-menu">
      <legend>Model</legend>
      {gemini.models.map((model) => (
        <div className="model-option" key={model.id}>
          <input
            type="radio"
            id={`${id}-${model.id}`}
            name={`${id}-model`}
            value={model.id}
            checked={chosen === model.id}
            onChange={() => engineSettings.setModel(model.id)}
            aria-describedby={model.note ? `${id}-${model.id}-note` : undefined}
          />
          <label htmlFor={`${id}-${model.id}`}>
            {model.label}
            <span className="mono muted model-id">{model.id}</span>
          </label>
          {model.note && (
            <p id={`${id}-${model.id}-note`} className="muted model-note">
              {model.note}
            </p>
          )}
        </div>
      ))}
      <p className="muted model-fallback">If the chosen model is busy, the next one on the list is tried.</p>
    </fieldset>
  );
}
