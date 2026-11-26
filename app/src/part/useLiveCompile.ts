import { useCallback, useEffect, useRef, useState } from 'react';
import { compiledModels } from '../models/compiled';
import { compile } from '../scad/client';
import { getPrinter } from '../slicer/printerChoice';
import { createLiveCompile, type LiveState, type Shown, type Sizes, startState } from './liveCompile';

// the space a part may fill on the chosen printer, as the slicer measures it
const chosenBed = () => getPrinter().printable;

export function useLiveCompile(source: string) {
  const [state, setState] = useState<LiveState>(startState);
  const live = useRef<ReturnType<typeof createLiveCompile> | null>(null);

  useEffect(() => {
    const current = createLiveCompile({ source, compile, onChange: setState, bed: chosenBed });
    live.current = current;
    current.request({}, { now: true });
    return () => current.dispose();
  }, [source]);

  const request = useCallback((sizes: Sizes, now = false) => live.current?.request(sizes, { now }), []);
  return { ...state, request };
}

const readyState = (shown: Shown, source: string): LiveState => ({
  status: 'idle',
  shown,
  shownSource: source,
  defaults: shown.params,
  problem: null,
});

// For a made part, whose code changes from version to version. One live compile follows the code, and the
// model on screen stays until the next one is ready. Code compiled before in this tab is shown at once.
export function useVersionCompile(source: string) {
  const [state, setState] = useState<LiveState>(() => {
    const ready = compiledModels.get(source);
    return ready ? readyState(ready, source) : startState();
  });
  const live = useRef<ReturnType<typeof createLiveCompile> | null>(null);

  useEffect(() => {
    const current = createLiveCompile({ source: '', compile, onChange: setState, onFresh: compiledModels.set, bed: chosenBed });
    live.current = current;
    return () => current.dispose();
  }, []);

  useEffect(() => {
    live.current?.setSource(source, compiledModels.get(source));
  }, [source]);

  const request = useCallback((sizes: Sizes, now = false) => live.current?.request(sizes, { now }), []);
  return { ...state, request };
}
