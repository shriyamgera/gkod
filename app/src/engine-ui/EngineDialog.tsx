import { type KeyboardEvent, type MouseEvent, type RefObject, useEffect, useId, useRef } from 'react';
import {
  bridgeStatus,
  type BridgeState,
  ENGINE_CHOICES,
  engineReady,
  ENGINES,
  type EngineId,
  engineSettings,
  useBridgeStatus,
  useEngineChoice,
  useEngineModel,
} from '../engine';
import { KeyPanel } from './KeyPanel';
import { PairingPanel } from './PairingPanel';
import './engine-ui.css';

type Props = { open: boolean; onClose: () => void };

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]):not([type="radio"]), input[type="radio"]:checked';
const CODE_FIELD = '.key-panel input:not([type="checkbox"])';

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
      // on this computer's own pages, or once found before, the bridge is looked for at once
      if (bridgeStatus.mayLookOnItsOwn() && bridgeStatus.snapshot().status !== 'checking') void bridgeStatus.check();
      // with no key or code yet the field is what the visitor came for; otherwise the title is read first
      const field = element.querySelector<HTMLInputElement>(CODE_FIELD);
      if (!engineReady(engineSettings.engine()) && field) field.focus();
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
          <EngineChoice dialog={dialog} />
        </div>
      )}
    </dialog>
  );
}

function EngineChoice({ dialog }: { dialog: RefObject<HTMLDialogElement | null> }) {
  const engine = useEngineChoice();
  const bridge = useBridgeStatus();
  const id = useId();
  // Claude Code is offered once the bridge answers on this computer (or while it is the engine in use)
  const shown = ENGINE_CHOICES.filter((choice) => choice.id === 'gemini' || bridge.status === 'found' || choice.id === engine);

  function choose(next: EngineId) {
    engineSettings.setEngine(next);
    // picking an engine that still needs a key or a code goes straight to its field
    if (!engineReady(next)) requestAnimationFrame(() => dialog.current?.querySelector<HTMLInputElement>(CODE_FIELD)?.focus());
  }

  return (
    <>
      {shown.length > 1 && (
        <fieldset className="model-menu engine-menu">
          <legend>Engine</legend>
          {shown.map((choice) => (
            <div className="model-option" key={choice.id}>
              <input
                type="radio"
                id={`${id}-${choice.id}`}
                name={`${id}-engine`}
                value={choice.id}
                checked={engine === choice.id}
                onChange={() => choose(choice.id)}
                aria-describedby={`${id}-${choice.id}-note`}
              />
              <label htmlFor={`${id}-${choice.id}`}>{choice.label}</label>
              <p id={`${id}-${choice.id}-note`} className="muted model-note">
                {choice.id === 'gemini'
                  ? 'Your own free key, sent only to Google.'
                  : 'Your own Claude Code, through the GKod bridge running on this Mac.'}
              </p>
            </div>
          ))}
        </fieldset>
      )}
      <BridgeLine bridge={bridge} engine={engine} />
      {engine === 'claude-code' ? (
        <PairingPanel title="Pair with the bridge on this Mac" titleAs="h3" />
      ) : (
        <KeyPanel title="GKod uses your own free Gemini key" titleAs="h3" />
      )}
      <ModelMenu engine={engine} />
    </>
  );
}

// What is known about the bridge, and on the public site a button to look for it.
function BridgeLine({ bridge, engine }: { bridge: BridgeState; engine: EngineId }) {
  if (bridge.status === 'checking') {
    return (
      <p role="status" className="muted bridge-line">
        Looking for the GKod bridge on this computer…
      </p>
    );
  }
  if (bridge.status === 'found') {
    const { health } = bridge;
    if (engine !== 'claude-code') return <p role="status" className="visually-hidden">GKod bridge found on this computer</p>;
    const problem = !health.claudeFound
      ? 'The bridge cannot find Claude Code on this Mac.'
      : health.loggedIn === false
        ? 'Claude Code is not logged in on this Mac. Run claude in a terminal and log in.'
        : null;
    return (
      <p role="status" className={problem ? 'key-message bridge-line' : 'muted bridge-line'}>
        {problem ?? `Bridge found: Claude Code ${health.claudeVersion ?? ''}${health.busy ? ', busy with another part' : ''}.`}
      </p>
    );
  }
  if (bridgeStatus.mayLookOnItsOwn() && bridge.status === 'unknown') return null;
  return (
    <div className="bridge-look">
      <button type="button" className="eu-quiet" onClick={() => void bridgeStatus.check()}>
        Look for Claude Code on this Mac
      </button>
      <p role="status" className="muted">
        {bridge.status === 'absent'
          ? 'No GKod bridge answered on this computer. It only runs on the owner’s own Mac.'
          : 'Only with the GKod bridge running on this computer. Your browser may ask to let this page reach apps on this device.'}
      </p>
    </div>
  );
}

function ModelMenu({ engine }: { engine: EngineId }) {
  const chosen = useEngineModel(engine);
  const id = useId();
  return (
    <fieldset className="model-menu">
      <legend>Model</legend>
      {ENGINES[engine].models.map((model) => (
        <div className="model-option" key={model.id}>
          <input
            type="radio"
            id={`${id}-${model.id}`}
            name={`${id}-model`}
            value={model.id}
            checked={chosen === model.id}
            onChange={() => engineSettings.setModel(model.id, engine)}
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
      <p className="muted model-fallback">
        {engine === 'gemini'
          ? 'If the chosen model is busy, the next one on the list is tried.'
          : 'Uses your own Claude plan. Answers are checked here like any other.'}
      </p>
    </fieldset>
  );
}
