import { type MouseEvent, useState } from 'react';
import { EngineDialog } from '../engine-ui/EngineDialog';
import { PROMPT_ID } from '../engine-ui/PromptBox';
import { links, type Route } from '../router';

export function Header({ route }: { route: Route }) {
  const [engineOpen, setEngineOpen] = useState(false);

  // On the start screen the link is already "here", so it moves focus to the prompt instead.
  function onMake(event: MouseEvent) {
    if (route.page !== 'start') return;
    event.preventDefault();
    window.scrollTo(0, 0);
    document.getElementById(PROMPT_ID)?.focus();
  }

  function onExamples(event: MouseEvent) {
    event.preventDefault();
    goToExamples(route.page === 'start');
  }

  return (
    <header className="site-header">
      <a className="wordmark" href={links.start} aria-label="GKod, start screen">
        GKOD
      </a>
      <nav className="site-nav" aria-label="Main">
        <a href={links.start} onClick={onMake} aria-current={route.page === 'start' ? 'page' : undefined}>
          Make
        </a>
        <a href={links.start} onClick={onExamples} aria-current={route.page === 'part' ? 'page' : undefined}>
          Examples
        </a>
        <button type="button" className="nav-button" aria-haspopup="dialog" onClick={() => setEngineOpen(true)}>
          Engine
        </button>
        <a href={links.notices} aria-current={route.page === 'notices' ? 'page' : undefined}>
          Notices
        </a>
      </nav>
      <EngineDialog open={engineOpen} onClose={() => setEngineOpen(false)} />
    </header>
  );
}

let examplesAsked = false;

// "Examples" scrolls to the list on the start screen, or opens the start screen first.
function goToExamples(onStartScreen: boolean) {
  if (onStartScreen) {
    focusExamples();
    return;
  }
  examplesAsked = true;
  window.location.hash = links.start;
}

// Called by the start screen once it is on the page.
export function showExamplesIfAsked() {
  if (!examplesAsked) return;
  examplesAsked = false;
  // runs after the app has focused the new screen's heading
  queueMicrotask(focusExamples);
}

function focusExamples() {
  const heading = document.getElementById('examples');
  if (!heading) return;
  heading.scrollIntoView({ block: 'start' });
  heading.focus({ preventScroll: true });
}
