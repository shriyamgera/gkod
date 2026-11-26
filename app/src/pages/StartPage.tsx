import { useEffect, useRef, useState } from 'react';
import { type EngineProblem, type EngineRequest, engineSettings, gemini, type ImageInput, keyStore, makePart } from '../engine';
import { KeyPanel } from '../engine-ui/KeyPanel';
import { PromptBox } from '../engine-ui/PromptBox';
import { chips, otherModel, requestText, titleFromRequest } from '../engine-ui/rules';
import { countSizes, examples } from '../examples';
import { compiledModels } from '../models/compiled';
import { modelStore } from '../models/store';
import { links } from '../router';
import { CANCEL_MESSAGE, compile, CRASH_MESSAGE, LOAD_MESSAGE } from '../scad/client';
import { showExamplesIfAsked } from '../shell/Header';

// failures of the compiler itself, which get no repair request
const BROWSER_FAILURES = [CANCEL_MESSAGE, CRASH_MESSAGE, LOAD_MESSAGE];

type Pending = { request: EngineRequest; title: string; text: string };
type Failure = { problem: EngineProblem | 'compile'; message: string; model: string };

export function StartPage() {
  const [prompt, setPrompt] = useState('');
  const [image, setImage] = useState<ImageInput | null>(null);
  const [readingPhoto, setReadingPhoto] = useState(false);
  const [keyAsk, setKeyAsk] = useState<{ message?: string } | null>(null);
  const [stage, setStage] = useState<string | null>(null);
  const [failure, setFailure] = useState<Failure | null>(null);
  const [note, setNote] = useState('');
  const running = useRef<AbortController | null>(null);
  const textarea = useRef<HTMLTextAreaElement>(null);
  const makeButton = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    showExamplesIfAsked();
    return () => {
      running.current?.abort();
      running.current = null;
    };
  }, []);

  function currentJob(): Pending | null {
    const text = requestText(prompt, image !== null);
    if (!text) return null;
    const request: EngineRequest = image ? { kind: 'create', prompt: text, image } : { kind: 'create', prompt: text };
    return { request, text, title: titleFromRequest(text, image !== null) };
  }

  // The request as it is on screen now, or null with a note saying what is missing.
  function jobOrNote(): Pending | null {
    if (readingPhoto) {
      setNote('Wait until the picture is read, then try again.');
      makeButton.current?.focus();
      return null;
    }
    const job = currentJob();
    if (!job) {
      setNote('Type what you want to print, or add a photo.');
      textarea.current?.focus();
    }
    return job;
  }

  function make() {
    const job = jobOrNote();
    if (!job) return;
    if (keyStore.get()) void run(job);
    else askForKey();
  }

  function askForKey(message?: string) {
    setFailure(null);
    setNote('');
    setKeyAsk(message ? { message } : {});
  }

  // The prompt or picture may have changed while the key panel was open, so the request is read again.
  function keySet() {
    setKeyAsk(null);
    const job = jobOrNote();
    if (job) void run(job);
  }

  function cancelKey() {
    setKeyAsk(null);
    makeButton.current?.focus();
  }

  async function run(job: Pending, model = engineSettings.model()) {
    running.current?.abort();
    const controller = new AbortController();
    running.current = controller;
    setKeyAsk(null);
    setFailure(null);
    setNote('');
    setStage('Writing the code');
    makeButton.current?.focus();

    let compiles = 0;
    const compileFn: typeof compile = async (source, overrides, opts) => {
      compiles += 1;
      setStage('Building the shape');
      const result = await compile(source, overrides, opts);
      if (!result.ok && compiles === 1 && !BROWSER_FAILURES.includes(result.error)) {
        setStage('Fixing a mistake and trying again');
      }
      return result;
    };

    const result = await makePart(gemini, job.request, { model, signal: controller.signal, compileFn });
    if (running.current !== controller) return;
    running.current = null;
    setStage(null);

    if (result.ok) {
      const { stl, params, ms } = result.result;
      compiledModels.set(result.code, { stl, params, ms });
      const saved = modelStore.create({
        title: job.title,
        request: job.text,
        code: result.code,
        label: 'First version',
        model: result.model,
      });
      window.location.hash = links.model(saved.id);
      return;
    }
    if (result.problem === 'cancelled') {
      setNote('Stopped.');
    } else if (result.problem === 'no-key' || result.problem === 'bad-key') {
      // a key Google turned down is not kept, so it is not sent again
      if (result.problem === 'bad-key') keyStore.forget();
      askForKey(result.problem === 'bad-key' ? result.message : undefined);
    } else {
      setFailure({ problem: result.problem, message: result.message, model: result.model ?? model });
    }
  }

  function stop() {
    // the Stop button is about to go, so focus moves back to the main button first
    makeButton.current?.focus();
    running.current?.abort();
  }

  function tryOther(modelId: string) {
    engineSettings.setModel(modelId);
    const job = jobOrNote();
    if (job) void run(job, modelId);
  }

  function fillChip(chip: string) {
    setPrompt(chip);
    setNote('');
    const box = textarea.current;
    if (!box) return;
    box.focus();
    requestAnimationFrame(() => box.setSelectionRange(chip.length, chip.length));
  }

  const busy = stage !== null;
  // A limit is per model, so another may still work. Busy is only reported once every model was tried.
  const other = failure?.problem === 'rate-limit' ? otherModel(gemini.models, failure.model) : undefined;

  return (
    <div className="start">
      <h1 className="display" tabIndex={-1}>
        What do you want to print?
      </h1>

      <div className="start-make">
        <PromptBox
          value={prompt}
          onChange={setPrompt}
          image={image}
          onImage={setImage}
          onReading={setReadingPhoto}
          busy={busy}
          onSubmit={make}
          textareaRef={textarea}
          buttonRef={makeButton}
        />

        {keyAsk && (
          <section className="key-inline" aria-label="Gemini key">
            <KeyPanel title="GKod uses your own free Gemini key" message={keyAsk.message} autoFocus onKeySet={keySet} onCancel={cancelKey} />
          </section>
        )}

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

        {failure && (
          <div className="make-problem" role="alert">
            <h2>
              <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true">
                <path d="M10 1.5 19 18H1z" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
                <path d="M10 7.5v5M10 14.5v2" stroke="currentColor" strokeWidth="1.8" />
              </svg>
              {failure.problem === 'busy' ? 'Gemini is busy' : 'Could not make the part'}
            </h2>
            <p>{failure.message}</p>
            <div className="make-problem-actions">
              <button type="button" className="eu-quiet" onClick={make}>
                Try again
              </button>
              {other && (
                <button type="button" className="eu-quiet" onClick={() => tryOther(other.id)}>
                  Try {other.label}
                </button>
              )}
            </div>
          </div>
        )}
      </div>

      <div className="chips" role="group" aria-labelledby="chips-label">
        <span className="muted" id="chips-label">
          Or try
        </span>
        {chips.map((chip) => (
          <button key={chip} type="button" className="chip" onClick={() => fillChip(chip)}>
            {chip}
          </button>
        ))}
      </div>

      <section className="start-examples" aria-labelledby="examples">
        <h2 id="examples" tabIndex={-1}>
          Or open an example <span className="muted">(no key needed)</span>
        </h2>
        <ul className="example-list">
          {examples.map((example) => (
            <li key={example.id}>
              <a href={links.part(example.id)}>
                <span className="example-name">{example.name}</span>
                <span className="example-meta mono">
                  {countSizes(example.source)} sizes
                  <svg width="20" height="14" viewBox="0 0 20 14" aria-hidden="true">
                    <path d="M0 7h18M12 1l6 6-6 6" fill="none" stroke="currentColor" strokeWidth="2.2" />
                  </svg>
                </span>
              </a>
            </li>
          ))}
        </ul>
      </section>

      <ol className="steps" aria-label="How it works">
        <li>
          <span className="mono muted">1</span>
          <strong>Describe it</strong>
          <span className="step-text">In words, or with a photo or a sketch.</span>
        </li>
        <li>
          <span className="mono muted">2</span>
          <strong>Change it live</strong>
          <span className="step-text">Type “make it wider”, or move a size slider.</span>
        </li>
        <li>
          <span className="mono muted">3</span>
          <strong>Download and print</strong>
          <span className="step-text">The part is built on your device and saved as an STL file for your slicer.</span>
        </li>
      </ol>
    </div>
  );
}
