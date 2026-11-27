import { CANCEL_MESSAGE, compile, CRASH_MESSAGE, LOAD_MESSAGE, TIMEOUT_MESSAGE } from '../scad/client';
import type { CompileResult } from '../scad/types';
import { MESSAGES } from './gemini';
import type { Engine, EngineProblem, EngineRequest } from './types';

type Compiled = Extract<CompileResult, { ok: true }>;

// session: the Claude Code session that wrote the code, kept on the part so a later change continues it
export type MakeResult =
  | { ok: true; code: string; result: Compiled; model: string; attempts: number; ms: number; session?: string; assumptions?: string }
  | { ok: false; message: string; problem: EngineProblem | 'compile'; code?: string; compileError?: string; model?: string };

export const compileFailed = (label: string) =>
  `The code from ${label} would not compile, even after one fix. Try again, or say it another way.`;

export const COMPILE_FAILED = compileFailed('Gemini');

const cancelled: MakeResult = { ok: false, problem: 'cancelled', message: MESSAGES.cancelled };

// What the repair request says the code was for.
function requestText(req: EngineRequest): string {
  if (req.kind === 'create') return req.prompt.trim() || 'the object in the attached picture';
  if (req.kind === 'edit') return `change the part: ${req.instruction.trim()}`;
  return req.request;
}

// A timeout message means nothing to the model, so it is told what to do about it.
function errorForRepair(error: string): string {
  return error === TIMEOUT_MESSAGE
    ? 'The compile took too long and was stopped. Make the code simpler and faster to build.'
    : error;
}

// These come from the browser, not the code, so a repair would not help.
const notTheCode = (error: string) => error === LOAD_MESSAGE || error === CRASH_MESSAGE;

type Options = {
  model?: string;
  signal?: AbortSignal;
  compileFn?: typeof compile;
  // Claude Code: the session to continue, and plain steps while it works
  session?: string;
  onProgress?: (step: string) => void;
};

// Only the fields an answer has, so a Gemini result looks exactly as it did before.
const extras = (answer: { session?: string; assumptions?: string }) => ({
  ...(answer.session ? { session: answer.session } : {}),
  ...(answer.assumptions ? { assumptions: answer.assumptions } : {}),
});

// Asks the engine for code and compiles it. If it does not compile, the error goes back once for a fix.
export async function makePart(engine: Engine, req: EngineRequest, opts: Options = {}): Promise<MakeResult> {
  const { signal, onProgress } = opts;
  const compileFn = opts.compileFn ?? compile;
  const began = performance.now();
  const elapsed = () => Math.round(performance.now() - began);
  const runOpts = (model: string | undefined, session: string | undefined) => ({
    model,
    signal,
    ...(session ? { session } : {}),
    ...(onProgress ? { onProgress } : {}),
  });

  const first = await engine.run(req, runOpts(opts.model, opts.session));
  let code: string;
  let error: string;
  let model = opts.model;
  // a repair continues the session that wrote the code
  const session = first.session ?? opts.session;
  if (first.ok) {
    const compiled = await compileFn(first.code, {}, { signal });
    if (compiled.ok) {
      return { ok: true, code: first.code, result: compiled, model: first.model, attempts: 1, ms: elapsed(), ...extras(first) };
    }
    if (signal?.aborted || compiled.error === CANCEL_MESSAGE) return cancelled;
    if (notTheCode(compiled.error)) {
      return { ok: false, problem: 'compile', message: compiled.error, code: first.code, compileError: compiled.error };
    }
    code = first.code;
    error = compiled.error;
    model = first.model;
  } else if (first.problem === 'blocked' && first.code) {
    code = first.code;
    error = first.message;
    model = first.model ?? model;
  } else {
    // model: the one that hit a limit, so another can be offered
    return { ok: false, problem: first.problem, message: first.message, model: first.model };
  }

  // the repair goes to the model that wrote the code, so a busy first choice is not asked again
  const repair: EngineRequest = { kind: 'repair', code, error: errorForRepair(error), request: requestText(req) };
  const second = await engine.run(repair, runOpts(model, session));
  if (!second.ok) {
    const blocked = second.problem === 'blocked';
    return {
      ok: false,
      problem: second.problem,
      message: second.message,
      code: second.code ?? code,
      compileError: blocked ? second.message : error,
      model: second.model,
    };
  }
  const compiled = await compileFn(second.code, {}, { signal });
  if (compiled.ok) {
    return { ok: true, code: second.code, result: compiled, model: second.model, attempts: 2, ms: elapsed(), ...extras(second) };
  }
  if (signal?.aborted || compiled.error === CANCEL_MESSAGE) return cancelled;
  const message = notTheCode(compiled.error) ? compiled.error : compileFailed(engine.label);
  return { ok: false, problem: 'compile', message, code: second.code, compileError: compiled.error };
}
