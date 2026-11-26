import type { GcodeReport } from '@gkod/checks';
import { useId, useState } from 'react';
import { CheckIcon, InfoIcon } from '../checks-ui/icons';
import { WarningIcon } from '../part/LiveStatus';
import { formatDuration, formatFilament, formatTemps } from './format';
import { type Finished, type Phase, problemLine } from './run';

export const UNSAFE = 'This file failed our safety check and was not offered for download.';
const MAX_SHOWN = 50;

type Props = {
  phase: Phase;
  // why a finished slice no longer matches the screen
  stale: string | null;
  fileName: string;
  onStop: () => void;
  onDownload: () => void;
};

/** Progress, the finished file, or what went wrong. */
export function PrintOutcome({ phase, stale, fileName, onStop, onDownload }: Props) {
  switch (phase.kind) {
    case 'slicing':
      return <Progress percent={phase.percent} onStop={onStop} />;
    case 'done':
      return <Result result={phase.result} stale={stale} fileName={fileName} onDownload={onDownload} />;
    case 'unsafe':
      return stale ? null : <Unsafe report={phase.report} />;
    case 'failed':
      return stale ? null : <Failed error={phase.error} />;
    case 'stopped':
      return <p className="print-note">Slicing stopped.</p>;
    default:
      return null;
  }
}

function Progress({ percent, onStop }: { percent: number; onStop: () => void }) {
  return (
    <div className="print-progress">
      <div className="print-progress-row">
        <span className="print-progress-text">
          Slicing <span className="mono">{percent}%</span>
        </span>
        <button type="button" className="button-quiet print-stop" onClick={onStop}>
          Stop
        </button>
      </div>
      <div
        className="print-bar"
        role="progressbar"
        aria-label="Slicing"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent}
      >
        <span style={{ width: `${percent}%` }} />
      </div>
    </div>
  );
}

type ResultProps = { result: Finished; stale: string | null; fileName: string; onDownload: () => void };

function Result({ result, stale, fileName, onDownload }: ResultProps) {
  const nozzle = formatTemps(result.safety.stats.nozzle);
  const bed = formatTemps(result.safety.stats.bed);
  const temps = [nozzle && `nozzle ${nozzle}`, bed && `bed ${bed}`].filter(Boolean).join(', ');
  return (
    <div className="print-result" data-stale={stale !== null}>
      {stale && (
        <p className="print-stale">
          <InfoIcon size={18} />
          {stale}
        </p>
      )}
      <p className="print-time">
        <strong>{formatDuration(result.seconds)}</strong> <span className="muted">(estimate, not exact)</span>
      </p>
      <ul className="print-facts">
        <li>{formatFilament(result.filamentMm)} of filament</li>
        <li>{result.layers} layers</li>
      </ul>
      {!stale && (
        <>
          <p className="print-safe">
            <CheckIcon size={16} />
            <span>Passed our safety check. PLA{temps && `, ${temps}`}.</span>
          </p>
          <button type="button" className="button-main print-download" onClick={onDownload}>
            Download G-code
            <svg width="16" height="18" viewBox="0 0 16 18" aria-hidden="true">
              <path d="M8 0v13M2 7l6 6 6-6M0 17h16" fill="none" stroke="currentColor" strokeWidth="2.2" />
            </svg>
          </button>
          <p className="mono muted print-file">
            {fileName}, sliced on this device in {(result.ms / 1000).toFixed(1)} s
          </p>
        </>
      )}
    </div>
  );
}

function Unsafe({ report }: { report: GcodeReport }) {
  const [open, setOpen] = useState(false);
  const listId = useId();
  const first = report.problems[0];
  const shown = report.problems.slice(0, MAX_SHOWN);
  const more = report.problems.length - shown.length;
  return (
    <section className="print-problem" aria-label="Safety check">
      <h3>
        <WarningIcon />
        {UNSAFE}
      </h3>
      <p>{first ? problemLine(first) : 'The check found a problem it could not name.'}</p>
      {report.problems.length > 0 && (
        <>
          <button
            type="button"
            className="button-link"
            aria-expanded={open}
            aria-controls={listId}
            onClick={() => setOpen(!open)}
          >
            {open ? 'Hide details' : 'Show details'}
          </button>
          <ul id={listId} className="print-problem-list" hidden={!open}>
            {shown.map((problem, i) => (
              <li key={i}>
                {problemLine(problem)}
                {problem.text && <code className="mono">{problem.text}</code>}
              </li>
            ))}
            {more > 0 && <li>And {more} more.</li>}
          </ul>
        </>
      )}
    </section>
  );
}

function Failed({ error }: { error: string }) {
  return (
    <section className="print-problem" aria-label="Slicing problem">
      <h3>
        <WarningIcon />
        Could not slice the part
      </h3>
      <p>{error}</p>
    </section>
  );
}

/** What the panel reads out when a slice settles. */
export function phaseAnnouncement(phase: Phase, stale: string | null): string {
  switch (phase.kind) {
    case 'slicing':
      return `Slicing for ${phase.sliced.printer.name}.`;
    case 'done': {
      const { seconds, filamentMm } = phase.result;
      return stale ?? `Sliced. ${formatDuration(seconds)}, ${formatFilament(filamentMm)} of filament. Ready to download.`;
    }
    case 'unsafe': {
      const first = phase.report.problems[0];
      return stale ? '' : `${UNSAFE}${first ? ` ${problemLine(first)}` : ''}`;
    }
    case 'failed':
      return stale ? '' : `Could not slice the part. ${phase.error}`;
    case 'stopped':
      return 'Slicing stopped.';
    default:
      return '';
  }
}
