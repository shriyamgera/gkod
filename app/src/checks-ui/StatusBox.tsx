import type { Report } from '@gkod/checks';
import { type ReactNode, type RefObject, useEffect, useId, useRef, useState } from 'react';
import { WarningIcon } from '../part/LiveStatus';
import { CheckIcon, InfoIcon } from './icons';
import {
  announcement,
  type BoxKind,
  boxKind,
  onlyOverhang,
  problems,
  problemTitle,
  readyLine,
  SUPPORTS_LINE,
  SUPPORTS_TITLE,
} from './wording';
import './checks-ui.css';

type Props = {
  report: Report | null;
  // the shape is being made or checked again; the last report stays on screen until the new one is in
  busy: boolean;
  onFix?: () => void;
  onSupports?: () => void;
  supportsChosen?: boolean;
  fixing?: boolean;
  canFix: boolean;
  // shown under Fix it for me when it cannot be used
  noFixReason?: string;
};

export function StatusBox(props: Props) {
  const { report, busy, supportsChosen = false } = props;
  const said = useSettled(announcement(report, supportsChosen), busy);
  const heading = useRef<HTMLHeadingElement>(null);
  const focused = useRef<HTMLElement | null>(null);
  const kind = boxKind(report, supportsChosen);

  // A fix or the supports choice can remove the button that was pressed. Focus then goes to the new heading
  // instead of the top of the page.
  useEffect(() => {
    const last = focused.current;
    if (last && !last.isConnected && document.activeElement === document.body) heading.current?.focus();
  }, [kind]);

  return (
    <div
      className="status"
      onFocus={(event) => {
        focused.current = event.target;
      }}
    >
      <p className="visually-hidden" aria-live="polite">
        {said}
      </p>
      {report ? (
        // keyed, so a button never turns into a different button under the keyboard focus
        <ReportBox key={kind} {...props} report={report} kind={kind} heading={heading} />
      ) : (
        busy && (
          <p className="status-checking">
            <span className="status-dot" aria-hidden="true" />
            Checking the shape
          </p>
        )
      )}
    </div>
  );
}

type BoxProps = Props & { report: Report; kind: BoxKind; heading: RefObject<HTMLHeadingElement | null> };

function ReportBox({
  report,
  kind,
  busy,
  onFix,
  onSupports,
  fixing = false,
  canFix,
  noFixReason = 'Fix it for me needs your Gemini key.',
  heading,
}: BoxProps) {
  const reasonId = useId();

  if (kind === 'ready') {
    return (
      <section className="status-box status-ok" aria-label="Print status" aria-busy={busy}>
        <Heading busy={busy} icon={<CheckIcon size={20} />} heading={heading}>
          Ready to print
        </Heading>
        <p>{readyLine(report)}</p>
      </section>
    );
  }

  if (kind === 'supports') {
    return (
      <section className="status-box status-supports" aria-label="Print status" aria-busy={busy}>
        <Heading busy={busy} icon={<InfoIcon />} heading={heading}>
          {SUPPORTS_TITLE}
        </Heading>
        <p>{SUPPORTS_LINE}</p>
        {onSupports && (
          <div className="status-actions">
            <button type="button" className="button-link" onClick={onSupports}>
              Print without supports
            </button>
          </div>
        )}
      </section>
    );
  }

  const found = problems(report);
  const fixable = canFix && onFix !== undefined;
  const fixOn = fixable && !busy && !fixing;
  const offerSupports = onSupports !== undefined && onlyOverhang(report);
  return (
    <section className="status-box status-fix" aria-label="Print status" aria-busy={busy}>
      <Heading busy={busy} icon={<WarningIcon />} heading={heading}>
        {problemTitle(found.length)}
      </Heading>
      {found.length === 1 ? (
        <p>{found[0]!.detail}</p>
      ) : (
        <ul className="status-list">
          {found.map((result) => (
            <li key={result.id}>{result.detail}</li>
          ))}
        </ul>
      )}
      <div className="status-actions">
        <button
          type="button"
          className="button-dark"
          aria-disabled={!fixOn}
          aria-describedby={fixable ? undefined : reasonId}
          onClick={fixOn ? onFix : undefined}
        >
          {fixing ? 'Fixing' : 'Fix it for me'}
        </button>
        {offerSupports && (
          <button
            type="button"
            className="button-link"
            aria-disabled={busy || fixing}
            onClick={busy || fixing ? undefined : onSupports}
          >
            Print with supports instead
          </button>
        )}
      </div>
      {!fixable && (
        <p id={reasonId} className="status-note">
          {noFixReason}
        </p>
      )}
    </section>
  );
}

// "Checking" sits in the heading row and only turns visible, so the box does not change height while a slider moves.
type HeadingProps = { busy: boolean; icon: ReactNode; heading: RefObject<HTMLHeadingElement | null>; children: string };

function Heading({ busy, icon, heading, children }: HeadingProps) {
  return (
    <div className="status-head">
      <h2 tabIndex={-1} ref={heading}>
        {icon}
        {children}
      </h2>
      <span className="status-busy" data-on={busy}>
        <span className="status-dot" aria-hidden="true" />
        <span>Checking</span>
      </span>
    </div>
  );
}

// Holds the last settled text while the shape is checked again, so a slider drag that ends where it
// started is not read out twice.
function useSettled(text: string, busy: boolean): string {
  const [settled, setSettled] = useState(text);
  if (!busy && text !== settled) setSettled(text);
  return busy ? settled : text;
}
