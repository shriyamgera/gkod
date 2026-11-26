import { useEffect, useState } from 'react';

export type Route =
  | { page: 'start' }
  | { page: 'part'; exampleId: string }
  | { page: 'model'; modelId: string }
  | { page: 'notices' }
  | { page: 'notFound' };

// GitHub Pages has no rewrites, so the route lives in the hash: "#/", "#/part/<id>", "#/model/<id>", "#/notices".
export function parseRoute(hash: string): Route {
  const path = hash.replace(/^#/, '').replace(/\/+$/, '');
  if (path === '') return { page: 'start' };
  if (path === '/notices') return { page: 'notices' };
  const match = /^\/(part|model)\/([^/]+)$/.exec(path);
  if (!match?.[2]) return { page: 'notFound' };
  let id: string;
  try {
    id = decodeURIComponent(match[2]);
  } catch {
    return { page: 'notFound' };
  }
  return match[1] === 'part' ? { page: 'part', exampleId: id } : { page: 'model', modelId: id };
}

export const links = {
  start: '#/',
  notices: '#/notices',
  part: (exampleId: string) => `#/part/${encodeURIComponent(exampleId)}`,
  model: (modelId: string) => `#/model/${encodeURIComponent(modelId)}`,
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
