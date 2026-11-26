import type { Report } from '@gkod/checks';
import { Disclosure } from '../part/Disclosure';
import { CheckIcon, CrossIcon } from './icons';
import './checks-ui.css';

/** "What we checked": every check with a word and an icon, so the result never rests on colour. */
export function CheckList({ report }: { report: Report | null }) {
  if (!report) return null;
  return (
    <Disclosure title="What we checked">
      <ul className="checks">
        {report.results.map((result) => (
          <li key={result.id} className={result.ok ? 'check' : 'check check-problem'}>
            <span className="check-word">
              {result.ok ? <CheckIcon /> : <CrossIcon />}
              {result.ok ? 'OK' : 'Problem'}
            </span>{' '}
            <span className="check-text">
              {result.title}{' '}
              {!result.ok && <span className="check-detail">{result.detail}</span>}
            </span>
          </li>
        ))}
      </ul>
      <p className="mono muted checks-time">Checked on this device in {Math.max(1, Math.round(report.ms))} ms</p>
    </Disclosure>
  );
}
