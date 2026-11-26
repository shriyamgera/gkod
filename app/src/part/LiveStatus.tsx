import type { LiveState, Problem as LiveProblem } from './liveCompile';

type ProblemProps = { problem: LiveProblem; hasModel: boolean; busy: boolean; onRetry: () => void };

export function LiveProblemBox({ problem, hasModel, busy, onRetry }: ProblemProps) {
  const { title, text } = describeProblem(problem, hasModel);
  // the same code with the same sizes fails the same way, so a code error gets no retry
  const canRetry = problem.kind === 'load' || problem.kind === 'crash' || (problem.kind === 'timeout' && !hasModel);
  return (
    <div className="part-problem">
      <h2>
        <WarningIcon />
        {title}
      </h2>
      <p>{text}</p>
      {hasModel && <p className="muted">The view still shows the last version that worked.</p>}
      {canRetry && (
        <button
          type="button"
          className="button-quiet part-retry"
          aria-disabled={busy}
          onClick={busy ? undefined : onRetry}
        >
          {busy ? 'Trying again' : 'Try again'}
        </button>
      )}
    </div>
  );
}

export function WarningIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true">
      <path d="M10 1.5 19 18H1z" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
      <path d="M10 7.5v5M10 14.5v2" stroke="currentColor" strokeWidth="1.8" />
    </svg>
  );
}

function describeProblem(problem: LiveProblem, hasModel: boolean): { title: string; text: string } {
  switch (problem.kind) {
    case 'load':
      return { title: 'Could not load the 3D engine', text: 'Check your connection, then try again.' };
    case 'timeout':
      return {
        title: 'This took too long',
        text: `The compiler was stopped after 10 seconds.${hasModel ? ' Try other sizes.' : ''}`,
      };
    default:
      return { title: 'Could not make the model', text: problem.message };
  }
}

export function viewerNote({ status, shown, problem }: LiveState): string | undefined {
  if (shown) return undefined;
  if (status === 'loading') return 'Getting the 3D engine ready';
  if (problem) return 'No model to show';
  return undefined;
}

// Read out by screen readers; problems have their own visible box.
export function statusText({ status, shown }: LiveState): string {
  if (status === 'loading') return 'Getting the 3D engine ready';
  if (!shown) return status === 'working' ? 'Making the model' : '';
  return 'Model ready';
}
