import { useCallback, useEffect, useRef, useState } from 'react';
import { compile } from '../scad/client';
import { createLiveCompile, type LiveState, type Sizes, startState } from './liveCompile';

export function useLiveCompile(source: string) {
  const [state, setState] = useState<LiveState>(startState);
  const live = useRef<ReturnType<typeof createLiveCompile> | null>(null);

  useEffect(() => {
    const current = createLiveCompile({ source, compile, onChange: setState });
    live.current = current;
    current.request({}, { now: true });
    return () => current.dispose();
  }, [source]);

  const request = useCallback((sizes: Sizes, now = false) => live.current?.request(sizes, { now }), []);
  return { ...state, request };
}
