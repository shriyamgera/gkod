import { useEffect, useRef } from 'react';
import { findExample } from './examples';
import { modelStore } from './models/store';
import { ModelPage } from './pages/ModelPage';
import { NotFoundPage } from './pages/NotFoundPage';
import { NoticesPage } from './pages/NoticesPage';
import { PartPage } from './pages/PartPage';
import { StartPage } from './pages/StartPage';
import { useRoute, type Route } from './router';
import { Footer } from './shell/Footer';
import { Header } from './shell/Header';

function Page({ route }: { route: Route }) {
  switch (route.page) {
    case 'start':
      return <StartPage />;
    case 'part':
      // a new key per part gives each one a fresh compile and a freshly framed view
      return <PartPage key={route.exampleId} exampleId={route.exampleId} />;
    case 'model':
      return <ModelPage key={route.modelId} modelId={route.modelId} />;
    case 'notices':
      return <NoticesPage />;
    case 'notFound':
      return <NotFoundPage />;
  }
}

function pageTitle(route: Route): string {
  switch (route.page) {
    case 'start':
      return 'GKod';
    case 'part':
      return `${findExample(route.exampleId)?.name ?? 'Page not found'} · GKod`;
    case 'model':
      return `${modelStore.get(route.modelId)?.title ?? 'Part not found'} · GKod`;
    case 'notices':
      return 'Notices · GKod';
    case 'notFound':
      return 'Page not found · GKod';
  }
}

export function App() {
  const route = useRoute();
  const firstRoute = useRef(route);

  useEffect(() => {
    document.title = pageTitle(route);
    // after a screen change, focus goes to the new heading so screen readers announce it
    if (route !== firstRoute.current) document.querySelector<HTMLElement>('main h1')?.focus({ preventScroll: true });
  }, [route]);

  return (
    <div className="app">
      <a className="skip-link" href="#main" onClick={skipToMain}>
        Skip to content
      </a>
      <Header route={route} />
      <main id="main" tabIndex={-1}>
        <Page route={route} />
      </main>
      <Footer />
    </div>
  );
}

// A plain "#main" link would replace the hash route, so move focus by hand.
function skipToMain(event: React.MouseEvent) {
  event.preventDefault();
  document.getElementById('main')?.focus();
}
