import { useEffect, useRef, useState } from 'react';
import { gemini } from '../engine';
import { ChangePanel, type Changed } from '../models/ChangePanel';
import { Changes } from '../models/Changes';
import { compiledModels } from '../models/compiled';
import { downloadName } from '../models/names';
import { currentVersion, modelStore, type SavedModel, useSavedModel } from '../models/store';
import '../models/models.css';
import { Disclosure } from '../part/Disclosure';
import { downloadFile } from '../part/download';
import type { Sizes } from '../part/liveCompile';
import { LiveProblemBox, statusText, viewerNote } from '../part/LiveStatus';
import { SizesPanel } from '../part/SizesPanel';
import { withValues } from '../part/sizes';
import { useVersionCompile } from '../part/useLiveCompile';
import '../part/part.css';
import { links } from '../router';
import { Viewer } from '../viewer/Viewer';

export function ModelPage({ modelId }: { modelId: string }) {
  const model = useSavedModel(modelId);
  if (!model) return <MissingModel />;
  return <ModelScreen model={model} />;
}

function MissingModel() {
  return (
    <div className="text-page">
      <h1 className="display" tabIndex={-1}>
        Part not found
      </h1>
      <p>This part is not in this browser tab any more. Parts you make are kept only in the tab that made them.</p>
      <p>
        <a href={links.start}>Make a new part</a>
      </p>
    </div>
  );
}

// Typing in these must not undo a version.
function isTextField(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement) return true;
  return target instanceof HTMLInputElement && !['range', 'checkbox', 'radio', 'button', 'submit'].includes(target.type);
}

function ModelScreen({ model }: { model: SavedModel }) {
  const version = currentVersion(model);
  const live = useVersionCompile(version.code);
  // Slider values are only a preview on top of the shown version. They do not make a version of their own;
  // the next typed change writes them into the code it sends. Moving to another version clears them.
  const [values, setValues] = useState<Sizes>({});
  const [said, setSaid] = useState('');
  const [changing, setChanging] = useState(false);
  const { shown, problem, status } = live;
  const { id } = model;

  // undo, redo and choosing a version all come through here
  const moveTo = useRef((next: SavedModel | undefined, before: number) => {
    if (!next || next.current === before) return;
    setValues({});
    setSaid(`Showing version ${next.current}: ${currentVersion(next).label}`);
  });

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (!(event.ctrlKey || event.metaKey) || event.altKey || event.key.toLowerCase() !== 'z') return;
      if (isTextField(event.target) || document.querySelector('dialog[open]')) return;
      event.preventDefault();
      const before = modelStore.get(id)?.current ?? 0;
      moveTo.current(event.shiftKey ? modelStore.redo(id) : modelStore.undo(id), before);
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [id]);

  const step = (move: (id: string) => SavedModel | undefined) => moveTo.current(move(id), model.current);

  function change(name: string, value: number) {
    const next = { ...values, [name]: value };
    setValues(next);
    live.request(next);
  }

  function reset() {
    setValues({});
    live.request({}, true);
  }

  function retry() {
    live.request(values, true);
  }

  // A typed change starts from the version on screen, with the slider values written in.
  function changed({ code, shown: made, model: by, label }: Changed): number {
    compiledModels.set(code, made);
    const next = modelStore.addVersion(id, { code, label, model: by });
    setValues({});
    return next?.current ?? version.v;
  }

  const liveLabel = Object.keys(values).length > 0 ? `${version.label}, sizes changed` : version.label;

  // After undo or redo the older model stays on screen until this version is built, so it is not offered as this one.
  const thisVersion = shown && live.shownSource === version.code ? shown : null;

  function save() {
    if (thisVersion) downloadFile(thisVersion.stl, downloadName(model.title, version.v));
  }

  return (
    <div className="part">
      <div className="part-head">
        <div className="part-heading">
          <a className="back-link" href={links.start}>
            ← New model
          </a>
          <div className="part-title">
            <h1 className="display" tabIndex={-1}>
              {model.title}
            </h1>
            <span className="mono muted">Version {version.v}</span>
          </div>
        </div>
        <button type="button" className="button-main" onClick={save} disabled={!thisVersion}>
          Download STL
          <svg width="16" height="18" viewBox="0 0 16 18" aria-hidden="true">
            <path d="M8 0v13M2 7l6 6 6-6M0 17h16" fill="none" stroke="currentColor" strokeWidth="2.2" />
          </svg>
        </button>
      </div>

      <div className="part-columns">
        <section className="part-view" aria-label="Your model">
          <Viewer
            stl={shown?.stl ?? null}
            busy={status !== 'idle' || changing}
            busyText={changing ? 'Changing' : 'Updating'}
            note={viewerNote(live)}
            live={liveLabel}
          />
          <ChangePanel currentCode={() => withValues(version.code, values)} onChanged={changed} onBusy={setChanging} />
        </section>

        <aside className="part-side" aria-label="Changes, sizes and code">
          <div role="status" className="part-status">
            {problem ? (
              <LiveProblemBox problem={problem} hasModel={shown !== null} busy={status !== 'idle'} onRetry={retry} />
            ) : (
              <span className="visually-hidden">{statusText(live)}</span>
            )}
          </div>

          <p role="status" className="visually-hidden">
            {said}
          </p>
          <Changes
            model={model}
            models={gemini.models}
            onSelect={(v) => moveTo.current(modelStore.select(id, v), model.current)}
            onUndo={() => step(modelStore.undo)}
            onRedo={() => step(modelStore.redo)}
          />

          <div className="part-details">
            <Disclosure title="Sizes" defaultOpen>
              <SizesPanel
                params={live.defaults}
                values={values}
                codeFailed={problem?.kind === 'error'}
                onChange={change}
                onReset={reset}
              />
            </Disclosure>
            <Disclosure title="Code">
              <pre className="code" tabIndex={0} aria-label={`OpenSCAD code for ${model.title}, version ${version.v}`}>
                {withValues(version.code, values)}
              </pre>
            </Disclosure>
          </div>

          {shown && <p className="mono muted">Compiled on this device in {Math.max(1, Math.round(shown.ms))} ms</p>}
        </aside>
      </div>
    </div>
  );
}
