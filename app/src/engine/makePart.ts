import { CANCEL_MESSAGE, compile, CRASH_MESSAGE, LOAD_MESSAGE, TIMEOUT_MESSAGE } from '../scad/client';
import type { CompileResult } from '../scad/types';
import { MESSAGES } from './gemini';
import type { Engine, EngineProblem, EngineRequest } from './types';

type Compiled = Extract<CompileResult, { ok: true }>;

export type MakeResult =
  | { ok: true; code: string; result: Compiled; model: string; attempts: number; ms: number }
  | { ok: false; message: string; problem: EngineProblem | 'compile'; code?: string; compileError?: string };

export const COMPILE_FAILED = 'The code from Gemini would not compile, even after one fix. Try again, or say it another way.';

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

type Options = { model?: string; signal?: AbortSignal; compileFn?: typeof compile };

// Asks the engine for code and compiles it. If it does not compile, the error goes back once for a fix.
export async function makePart(engine: Engine, req: EngineRequest, opts: Options = {}): Promise<MakeResult> {
  const { signal } = opts;
  const compileFn = opts.compileFn ?? compile;
  const began = performance.now();
  const elapsed = () => Math.round(performance.now() - began);

  const first = await engine.run(req, { model: opts.model, signal });
  let code: string;
  let error: string;
  let model = opts.model;
  if (first.ok) {
    const compiled = await compileFn(first.code, {}, { signal });
    if (compiled.ok) return { ok: true, code: first.code, result: compiled, model: first.model, attempts: 1, ms: elapsed() };
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
    return { ok: false, problem: first.problem, message: first.message };
  }

  // the repair goes to the model that wrote the code, so a busy first choice is not asked again
  const repair: EngineRequest = { kind: 'repair', code, error: errorForRepair(error), request: requestText(req) };
  const second = await engine.run(repair, { model, signal });
  if (!second.ok) {
    const blocked = second.problem === 'blocked';
    return {
      ok: false,
      problem: second.problem,
      message: second.message,
      code: second.code ?? code,
      compileError: blocked ? second.message : error,
    };
  }
  const compiled = await compileFn(second.code, {}, { signal });
  if (compiled.ok) return { ok: true, code: second.code, result: compiled, model: second.model, attempts: 2, ms: elapsed() };
  if (signal?.aborted || compiled.error === CANCEL_MESSAGE) return cancelled;
  const message = notTheCode(compiled.error) ? compiled.error : COMPILE_FAILED;
  return { ok: false, problem: 'compile', message, code: second.code, compileError: compiled.error };
}
