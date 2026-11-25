import { links, type Route } from '../router';

export function Header({ route }: { route: Route }) {
  const onExamples = route.page === 'start' || route.page === 'part';
  return (
    <header className="site-header">
      <a className="wordmark" href={links.start} aria-label="GKod, start screen">
        GKOD
      </a>
      <nav className="site-nav" aria-label="Main">
        <a href={links.start} aria-current={onExamples ? 'page' : undefined}>
          Examples
        </a>
        <a href={links.notices} aria-current={route.page === 'notices' ? 'page' : undefined}>
          Notices
        </a>
      </nav>
    </header>
  );
}
