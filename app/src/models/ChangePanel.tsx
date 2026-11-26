import { useEffect, useRef, useState } from 'react';
import { type EngineProblem, engineSettings, gemini, keyStore, makePart } from '../engine';
import { KeyPanel } from '../engine-ui/KeyPanel';
import { otherModel } from '../engine-ui/rules';
import { type Shown, shownOf } from '../part/liveCompile';
import { WarningIcon } from '../part/LiveStatus';
import { CANCEL_MESSAGE, compile, CRASH_MESSAGE, LOAD_MESSAGE } from '../scad/client';
import { getPrinter } from '../slicer/printerChoice';
import { ChangeBox } from './ChangeBox';
import { modelName, versionLabel } from './names';

// failures of the compiler itself, which get no repair request
const BROWSER_FAILURES = [CANCEL_MESSAGE, CRASH_MESSAGE, LOAD_MESSAGE];

export type Changed = { code: string; shown: Shown; model: string; label: string };

type Failure = { problem: EngineProblem | 'compile'; message: string; model: string };

type Props = {
  // the code of the version on screen, with any slider values written into it
  currentCode: () => string;
  onChanged: (changed: Changed) => number;
  onBusy: (busy: boolean) => void;
};

// Sends a typed change and the current code to the engine. The new code only becomes a version once it
// compiles; until then, and on any failure, the version on screen stays as it is.
export function ChangePanel({ currentCode, onChanged, onBusy }: Props) {
  const [text, setText] = useState('');
  const [stage, setStage] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [failure, setFailure] = useState<Failure | null>(null);
  const [keyAsk, setKeyAsk] = useState<{ message?: string } | null>(null);
  const asked = useRef('');
  const running = useRef<AbortController | null>(null);
  const field = useRef<HTMLInputElement>(null);

  useEffect(
    () => () => {
      running.current?.abort();
      running.current = null;
    },
    [],
  );

  // The change as it is in the field now, or null with a note saying it is empty.
  function instructionOrNote(): string | null {
    const instruction = text.trim();
    if (!instruction) {
      setNote('Type a change first, for example “make it 10 mm wider”.');
      field.current?.focus();
      return null;
    }
    return instruction;
  }

  function submit() {
    const instruction = instructionOrNote();
    if (!instruction) return;
    if (keyStore.get()) void run(instruction);
    else askForKey();
  }

  function askForKey(message?: string) {
    setFailure(null);
    setNote('');
    setKeyAsk(message ? { message } : {});
  }

  // The field may have changed while the key panel was open, so it is read again.
  function keySet() {
    // the key panel, which holds focus, is about to go, so focus moves to the field first
    field.current?.focus();
    setKeyAsk(null);
    const instruction = instructionOrNote();
    if (instruction) void run(instruction);
  }

  function cancelKey() {
    setKeyAsk(null);
    field.current?.focus();
  }

  async function run(instruction: string, model = engineSettings.model()) {
    running.current?.abort();
    const controller = new AbortController();
    running.current = controller;
    asked.current = instruction;
    setKeyAsk(null);
    setFailure(null);
    setNote('');
    setStage('Writing the change');
    onBusy(true);

    let compiles = 0;
    const compileFn: typeof compile = async (source, overrides, opts) => {
      compiles += 1;
      setStage('Building the shape');
      const result = await compile(source, overrides, { ...opts, bed: getPrinter().printable });
      if (!result.ok && compiles === 1 && !BROWSER_FAILURES.includes(result.error)) {
        setStage('Fixing a mistake and trying again');
      }
      return result;
    };

    const request = { kind: 'edit' as const, instruction, code: currentCode() };
    const result = await makePart(gemini, request, { model, signal: controller.signal, compileFn });
    if (running.current !== controller) return;
    running.current = null;
    setStage(null);
    onBusy(false);

    if (result.ok) {
      const label = versionLabel(instruction);
      const v = onChanged({ code: result.code, shown: shownOf(result.result), model: result.model, label });
      setText('');
      const seconds = (result.ms / 1000).toFixed(1);
      // a no-break space keeps the number and its unit on one line
      setNote(`Version ${v} ready. ${modelName(result.model, gemini.models)} took ${seconds}\u00a0s.`);
      return;
    }
    if (result.problem === 'cancelled') {
      setNote('Stopped. The part is as it was.');
    } else if (result.problem === 'no-key' || result.problem === 'bad-key') {
      // a key Google turned down is not kept, so it is not sent again
      if (result.problem === 'bad-key') keyStore.forget();
      askForKey(result.problem === 'bad-key' ? result.message : undefined);
    } else {
      setFailure({ problem: result.problem, message: result.message, model: result.model ?? model });
    }
  }

  function stop() {
    // the Stop button is about to go, so focus moves back to the field first
    field.current?.focus();
    running.current?.abort();
  }

  function tryAgain(model?: string) {
    // the problem box is about to go, so focus moves to the field first
    field.current?.focus();
    if (model) engineSettings.setModel(model);
    if (asked.current) void run(asked.current, model);
  }

  const busy = stage !== null;
  // A limit is per model, so another may still work. Busy is only reported once every model was tried.
  const other = failure?.problem === 'rate-limit' ? otherModel(gemini.models, failure.model) : undefined;

  return (
    <ChangeBox value={text} onChange={setText} onSubmit={submit} busy={busy} inputRef={field}>
      <div className={stage || note ? 'make-status has-text' : 'make-status'}>
        <p role="status">
          {stage ? (
            <>
              <span className="make-spinner" aria-hidden="true" />
              {stage}
            </>
          ) : (
            note
          )}
        </p>
        {stage && (
          <button type="button" className="eu-quiet" onClick={stop}>
            Stop
          </button>
        )}
      </div>

      {keyAsk && (
        <section className="key-inline" aria-label="Gemini key">
          <KeyPanel
            title="GKod uses your own free Gemini key"
            message={keyAsk.message}
            autoFocus
            onKeySet={keySet}
            onCancel={cancelKey}
          />
        </section>
      )}

      {failure && (
        <div className="make-problem" role="alert">
          <h2>
            <WarningIcon />
            {failure.problem === 'busy' ? 'Gemini is busy' : 'Could not change the part'}
          </h2>
          <p>{failure.message}</p>
          <p className="muted">The part is as it was.</p>
          <div className="make-problem-actions">
            <button type="button" className="eu-quiet" onClick={() => tryAgain()}>
              Try again
            </button>
            {other && (
              <button type="button" className="eu-quiet" onClick={() => tryAgain(other.id)}>
                Try {other.label}
              </button>
            )}
          </div>
        </div>
      )}
    </ChangeBox>
  );
}
