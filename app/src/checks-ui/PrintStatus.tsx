import type { Report } from '@gkod/checks';
import { useRef } from 'react';
import { CredentialPanel } from '../engine-ui/CredentialPanel';
import { WarningIcon } from '../part/LiveStatus';
import { StatusBox } from './StatusBox';
import type { FixHandle } from './useFix';

type Props = {
  report: Report | null;
  busy: boolean;
  fix: FixHandle;
  onFix: () => void;
  supportsChosen: boolean;
  onSupports: () => void;
};

/** The print status box, with the progress of "Fix it for me", the key it needs and anything that went wrong. */
export function PrintStatus({ report, busy, fix, onFix, supportsChosen, onSupports }: Props) {
  const area = useRef<HTMLDivElement>(null);
  const { stage, note, failure, keyAsk } = fix;

  // The Stop button, the key panel and the problem box all go away when used, so focus goes back to the box.
  function backToBox() {
    const box = area.current;
    (box?.querySelector<HTMLElement>('.status-actions button') ?? box?.querySelector<HTMLElement>('.status-head h2'))?.focus();
  }

  return (
    <div ref={area}>
      <StatusBox
        report={report}
        busy={busy}
        canFix
        onFix={onFix}
        fixing={fix.fixing}
        supportsChosen={supportsChosen}
        onSupports={onSupports}
      />

      <div className={stage || note ? 'fix-status has-text' : 'fix-status'}>
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
          <button
            type="button"
            className="button-quiet"
            onClick={() => {
              backToBox();
              fix.stop();
            }}
          >
            Stop
          </button>
        )}
      </div>

      {keyAsk && (
        <CredentialPanel
          engine={keyAsk.engine}
          className="key-inline fix-key"
          keyTitle="Fix it for me uses your own free Gemini key"
          message={keyAsk.message}
          onSet={() => {
            backToBox();
            fix.closeKey();
            onFix();
          }}
          onCancel={() => {
            fix.closeKey();
            backToBox();
          }}
        />
      )}

      {failure && (
        <div className="make-problem fix-problem" role="alert">
          <h2>
            <WarningIcon />
            {failure.problem === 'busy' ? `${failure.engineLabel ?? 'Gemini'} is busy` : 'Could not fix the part'}
          </h2>
          <p>{failure.message}</p>
          <p className="muted">The part is as it was.</p>
          <div className="make-problem-actions">
            <button
              type="button"
              className="button-quiet"
              onClick={() => {
                backToBox();
                onFix();
              }}
            >
              Try again
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
