import { useEffect, useRef, useState } from 'react';
import {
  currentEngine,
  type EngineId,
  type EngineProblem,
  engineReady,
  engineSettings,
  forgetTurnedDown,
  makePart,
  needsCredential,
} from '../engine';
import { type Shown, shownOf } from '../part/liveCompile';
import { CANCEL_MESSAGE, compile, CRASH_MESSAGE, LOAD_MESSAGE } from '../scad/client';
import { getPrinter } from '../slicer/printerChoice';

// failures of the compiler itself, which get no repair request
const BROWSER_FAILURES = [CANCEL_MESSAGE, CRASH_MESSAGE, LOAD_MESSAGE];

// session: the Claude Code session that made the fix, kept on the part
export type Fixed = { code: string; shown: Shown; model: string; session?: string };

// instruction: our own fix text for every failed check; code: the code on screen with the slider values
// written in; keep: saves the fixed part and returns what to say about it; session: the Claude Code session
// that last worked on the part, continued when Claude Code makes the fix
export type FixJob = { instruction: string; code: string; keep: (fixed: Fixed) => string; session?: string };

export type FixFailure = { problem: EngineProblem | 'compile'; message: string; engineLabel?: string };

export type FixKeyAsk = { engine: EngineId; message?: string };

// A note to show on the page a fix opens, e.g. when the fix of an example makes a new part.
const handedOver = new Map<string, string>();

export function handOverNote(modelId: string, note: string) {
  handedOver.set(modelId, note);
}

// "Fix it for me": sends the failed checks' fix text to the engine as a change of the code on screen.
// The fixed code is kept only once it compiles; on any failure the part stays as it was.
export function useFix(modelId?: string) {
  const [stage, setStage] = useState<string | null>(null);
  const [note, setNote] = useState(() => (modelId ? (handedOver.get(modelId) ?? '') : ''));
  const [failure, setFailure] = useState<FixFailure | null>(null);
  const [keyAsk, setKeyAsk] = useState<FixKeyAsk | null>(null);
  const running = useRef<AbortController | null>(null);

  useEffect(() => {
    // shown once; a later visit to the same part starts without it
    if (modelId) handedOver.delete(modelId);
    return () => {
      running.current?.abort();
      running.current = null;
    };
  }, [modelId]);

  function clear() {
    setKeyAsk(null);
    setFailure(null);
    setNote('');
  }

  function start(job: FixJob) {
    clear();
    const { id } = currentEngine();
    if (engineReady(id)) void run(job);
    else setKeyAsk({ engine: id });
  }

  async function run(job: FixJob) {
    running.current?.abort();
    const controller = new AbortController();
    running.current = controller;
    const engine = currentEngine();
    const isClaude = engine.id === 'claude-code';
    setStage(isClaude ? 'Asking Claude Code on this Mac for the fix' : 'Writing the fix');

    let compiles = 0;
    const compileFn: typeof compile = async (source, overrides, opts) => {
      compiles += 1;
      setStage('Building the shape');
      const result = await compile(source, overrides, { ...opts, bed: getPrinter().printable });
      if (!result.ok && compiles === 1 && !BROWSER_FAILURES.includes(result.error)) {
        setStage('Fixing a mistake and trying again');
      }
      return result;
    };

    const request = { kind: 'edit' as const, instruction: job.instruction, code: job.code };
    const onProgress = (step: string) => {
      if (running.current === controller) setStage(step);
    };
    const result = await makePart(engine, request, {
      model: engineSettings.model(engine.id),
      signal: controller.signal,
      compileFn,
      onProgress,
      session: isClaude ? job.session : undefined,
    });
    if (running.current !== controller) return;
    running.current = null;
    setStage(null);

    if (result.ok) {
      setNote(job.keep({ code: result.code, shown: shownOf(result.result), model: result.model, session: result.session }));
    } else if (result.problem === 'cancelled') {
      setNote('Stopped. The part is as it was.');
    } else if (needsCredential(result.problem)) {
      // a key or code that was turned down is not kept, so it is not sent again
      forgetTurnedDown(result.problem);
      const turnedDown = result.problem === 'bad-key' || result.problem === 'bad-pairing';
      setKeyAsk(turnedDown ? { engine: engine.id, message: result.message } : { engine: engine.id });
    } else {
      forgetTurnedDown(result.problem);
      setFailure({ problem: result.problem, message: result.message, engineLabel: engine.label });
    }
  }

  return {
    stage,
    note,
    failure,
    keyAsk,
    fixing: stage !== null,
    start,
    stop: () => running.current?.abort(),
    closeKey: () => setKeyAsk(null),
    // a new typed change or a new version makes the last fix note out of date
    clear,
  };
}

export type FixHandle = ReturnType<typeof useFix>;
