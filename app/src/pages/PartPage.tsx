import { useState } from 'react';
import { findExample } from '../examples';
import { Disclosure } from '../part/Disclosure';
import { downloadFile } from '../part/download';
import type { LiveState, Sizes } from '../part/liveCompile';
import { SizesPanel } from '../part/SizesPanel';
import { stlFileName, withValues } from '../part/sizes';
import { useLiveCompile } from '../part/useLiveCompile';
import '../part/part.css';
import { links } from '../router';
import { Viewer } from '../viewer/Viewer';
import { NotFoundPage } from './NotFoundPage';

type Example = { id: string; name: string; source: string };

export function PartPage({ exampleId }: { exampleId: string }) {
  const example = findExample(exampleId);
  if (!example) return <NotFoundPage />;
  return <PartScreen example={example} />;
}

function PartScreen({ example }: { example: Example }) {
  const live = useLiveCompile(example.source);
  // only the sizes the visitor has changed; the rest keep the values written in the code
  const [values, setValues] = useState<Sizes>({});
  const { shown, problem, status } = live;

  function change(name: string, value: number) {
    const next = { ...values, [name]: value };
    setValues(next);
    live.request(next);
  }

  function reset() {
    setValues({});
    live.request({}, true);
  }

  function download() {
    if (shown) downloadFile(shown.stl, stlFileName(example.id, shown.params));
  }

  return (
    <div className="part">
      <div className="part-head">
        <div className="part-heading">
          <a className="back-link" href={links.start}>
            ← All examples
          </a>
          <div className="part-title">
            <h1 className="display">{example.name}</h1>
            <span className="mono muted">Example part</span>
          </div>
        </div>
        <button type="button" className="button-main" onClick={download} disabled={!shown}>
          Download STL
          <svg width="16" height="18" viewBox="0 0 16 18" aria-hidden="true">
            <path d="M8 0v13M2 7l6 6 6-6M0 17h16" fill="none" stroke="currentColor" strokeWidth="2.2" />
          </svg>
        </button>
      </div>

      <div className="part-columns">
        <section className="part-view" aria-label="Your model">
          <Viewer stl={shown?.stl ?? null} busy={status !== 'idle'} note={viewerNote(live)} />
        </section>

        <aside className="part-side" aria-label="Sizes and code">
          <div role="status" className="part-status">
            {problem ? <Problem problem={problem} hasModel={shown !== null} /> : <span className="visually-hidden">{statusText(live)}</span>}
          </div>

          <div className="part-details">
            <Disclosure title="Sizes" defaultOpen>
              <SizesPanel
                params={live.defaults}
                values={values}
                waiting={!problem}
                onChange={change}
                onReset={reset}
              />
            </Disclosure>
            <Disclosure title="Code">
              <pre className="code" tabIndex={0} aria-label={`OpenSCAD code for ${example.name}`}>
                {withValues(example.source, values)}
              </pre>
            </Disclosure>
          </div>

          {shown && <p className="mono muted">Compiled on this device in {Math.max(1, Math.round(shown.ms))} ms</p>}
        </aside>
      </div>
    </div>
  );
}

function Problem({ problem, hasModel }: { problem: NonNullable<LiveState['problem']>; hasModel: boolean }) {
  const timedOut = problem.kind === 'timeout';
  return (
    <div className="part-problem">
      <h2>
        <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true">
          <path d="M10 1.5 19 18H1z" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
          <path d="M10 7.5v5M10 14.5v2" stroke="currentColor" strokeWidth="1.8" />
        </svg>
        {timedOut ? 'This took too long' : 'Could not make the model'}
      </h2>
      <p>{timedOut ? 'The compiler was stopped after 10 seconds. Try other sizes.' : problem.message}</p>
      {hasModel && <p className="muted">The view still shows the last version that worked.</p>}
    </div>
  );
}

function viewerNote({ status, shown, problem }: LiveState): string | undefined {
  if (shown) return undefined;
  if (status === 'loading') return 'Getting the 3D engine ready';
  if (problem) return 'No model to show';
  return undefined;
}

// Read out by screen readers; problems have their own visible box.
function statusText({ status, shown }: LiveState): string {
  if (status === 'loading') return 'Getting the 3D engine ready';
  if (!shown) return status === 'working' ? 'Making the model' : '';
  return 'Model ready';
}
