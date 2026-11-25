import { useEffect, useState } from 'react';

export type Route =
  | { page: 'start' }
  | { page: 'part'; exampleId: string }
  | { page: 'notices' }
  | { page: 'notFound' };

// GitHub Pages has no rewrites, so the route lives in the hash: "#/", "#/part/<id>", "#/notices".
export function parseRoute(hash: string): Route {
  const path = hash.replace(/^#/, '').replace(/\/+$/, '');
  if (path === '') return { page: 'start' };
  if (path === '/notices') return { page: 'notices' };
  const part = /^\/part\/([^/]+)$/.exec(path);
  if (part?.[1]) {
    try {
      return { page: 'part', exampleId: decodeURIComponent(part[1]) };
    } catch {
      return { page: 'notFound' };
    }
  }
  return { page: 'notFound' };
}

export const links = {
  start: '#/',
  notices: '#/notices',
  part: (exampleId: string) => `#/part/${encodeURIComponent(exampleId)}`,
};

export function useRoute(): Route {
  const [route, setRoute] = useState(() => parseRoute(window.location.hash));
  useEffect(() => {
    const onChange = () => {
      setRoute(parseRoute(window.location.hash));
      window.scrollTo(0, 0);
    };
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, []);
  return route;
}
