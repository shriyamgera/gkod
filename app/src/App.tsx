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
    case 'notices':
      return <NoticesPage />;
    case 'notFound':
      return <NotFoundPage />;
  }
}

export function App() {
  const route = useRoute();
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
