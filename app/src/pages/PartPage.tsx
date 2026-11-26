import { useEffect, useRef, useState } from 'react';
import { CheckList } from '../checks-ui/CheckList';
import { PrintStatus } from '../checks-ui/PrintStatus';
import { handOverNote, useFix } from '../checks-ui/useFix';
import { fixedNote, fixLabel, fixRequest, viewerMark } from '../checks-ui/wording';
import { findExample } from '../examples';
import { compiledModels } from '../models/compiled';
import { modelStore } from '../models/store';
import { Disclosure } from '../part/Disclosure';
import { downloadFile } from '../part/download';
import type { Sizes } from '../part/liveCompile';
import { LiveProblemBox, statusText, viewerNote } from '../part/LiveStatus';
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
  // print with supports instead of fixing the overhang; an example has no versions, so it lives here
  const [supports, setSupports] = useState(false);
  const { shown, problem, status } = live;
  const report = shown?.checks ?? null;
  const fixer = useFix();
  const heading = useRef<HTMLHeadingElement>(null);
  const retrying = useRef(false);

  // The Try again button goes away once it works, so focus moves to the heading instead of being lost.
  useEffect(() => {
    if (status !== 'idle' || !retrying.current) return;
    retrying.current = false;
    if (!problem) heading.current?.focus();
  }, [status, problem]);

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
    retrying.current = true;
    live.request(values, true);
  }

  // An example cannot change, so its fix becomes a new made part: the example as it is on screen, then the fix.
  function fix() {
    if (!report) return;
    const start = withValues(example.source, values);
    const startShown = shown;
    fixer.start({
      instruction: fixRequest(report),
      code: start,
      keep: ({ code, shown: made, model }) => {
        const saved = modelStore.create({
          title: `${example.name} (fixed)`,
          request: `${example.name} example`,
          code: start,
          label: 'From the example',
        });
        if (startShown) compiledModels.set(start, startShown);
        compiledModels.set(code, made);
        const next = modelStore.addVersion(saved.id, { code, label: fixLabel(report, made.checks), model });
        const note = fixedNote(next?.current ?? 2, 1, report, made.checks);
        handOverNote(saved.id, note);
        window.location.hash = links.model(saved.id);
        return note;
      },
    });
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
            <h1 className="display" tabIndex={-1} ref={heading}>
              {example.name}
            </h1>
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
          <Viewer
            stl={shown?.stl ?? null}
            busy={status !== 'idle' || fixer.fixing}
            busyText={fixer.fixing ? 'Fixing' : 'Updating'}
            note={viewerNote(live)}
            mark={viewerMark(report, supports)}
          />
        </section>

        <aside className="part-side" aria-label="Print status, sizes and code">
          <div role="status" className="part-status">
            {problem ? (
              <LiveProblemBox problem={problem} hasModel={shown !== null} busy={status !== 'idle'} onRetry={retry} />
            ) : (
              <span className="visually-hidden">{statusText(live)}</span>
            )}
          </div>
          {!problem && (
            <PrintStatus
              report={report}
              busy={status !== 'idle'}
              fix={fixer}
              onFix={fix}
              supportsChosen={supports}
              onSupports={() => setSupports(!supports)}
            />
          )}

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
            <CheckList report={report} />
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
