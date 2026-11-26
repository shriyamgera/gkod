import { describe, expect, it, vi } from 'vitest';
import { CANCEL_MESSAGE, LOAD_MESSAGE, TIMEOUT_MESSAGE, type compile } from '../scad/client';
import type { CompileResult } from '../scad/types';
import { COMPILE_FAILED, makePart } from './makePart';
import type { Engine, EngineAnswer, EngineRequest } from './types';

const good = '// Width (mm)\nwidth = 40; // [20:1:80]\ncube([width, 20, 5]);\n';
const broken = 'cube([width, 20, 5]);\n';

const passed: CompileResult = { ok: true, stl: new ArrayBuffer(84), params: [], log: [], ms: 5 };
const failed = (error: string): CompileResult => ({ ok: false, error, log: [], ms: 5 });

function fakeEngine(answers: EngineAnswer[]) {
  const requests: { req: EngineRequest; model?: string }[] = [];
  const engine: Engine = {
    id: 'gemini',
    label: 'Gemini',
    models: [],
    run: vi.fn(async (req: EngineRequest, opts?: { model?: string }) => {
      requests.push({ req, model: opts?.model });
      const answer = answers[requests.length - 1];
      if (!answer) throw new Error('no more answers');
      return answer;
    }),
  };
  return { engine, requests };
}

function fakeCompile(results: CompileResult[]) {
  const sources: string[] = [];
  const fn = vi.fn(async (source: string) => {
    sources.push(source);
    const result = results[sources.length - 1];
    if (!result) throw new Error('no more results');
    return result;
  });
  return { compileFn: fn as unknown as typeof compile, sources };
}

const create: EngineRequest = { kind: 'create', prompt: 'A box' };
const code = (text: string, model = 'gemini-3.1-flash-lite'): EngineAnswer => ({ ok: true, code: text, model, ms: 10 });

describe('makePart', () => {
  it('returns the first code that compiles', async () => {
    const { engine, requests } = fakeEngine([code(good)]);
    const { compileFn, sources } = fakeCompile([passed]);
    const result = await makePart(engine, create, { compileFn });
    expect(result).toMatchObject({ ok: true, code: good, model: 'gemini-3.1-flash-lite', attempts: 1 });
    expect(result.ok && result.result).toBe(passed);
    expect(requests).toHaveLength(1);
    expect(sources).toEqual([good]);
  });

  it('sends one repair with the compile error, then uses the fixed code', async () => {
    const { engine, requests } = fakeEngine([code(broken, 'gemini-3-flash-preview'), code(good, 'gemini-3-flash-preview')]);
    const { compileFn, sources } = fakeCompile([failed('Line 1: Unknown variable "width"'), passed]);
    const result = await makePart(engine, create, { compileFn, model: 'gemini-3.8-flash' });
    expect(result).toMatchObject({ ok: true, code: good, attempts: 2, model: 'gemini-3-flash-preview' });
    expect(sources).toEqual([broken, good]);
    expect(requests[0]).toEqual({ req: create, model: 'gemini-3.8-flash' });
    // the repair goes to the model that answered, not the busy first choice
    expect(requests[1]).toEqual({
      req: { kind: 'repair', code: broken, error: 'Line 1: Unknown variable "width"', request: 'A box' },
      model: 'gemini-3-flash-preview',
    });
  });

  it('gives up after one repair and returns the last error and code', async () => {
    const { engine, requests } = fakeEngine([code(broken), code(`${broken}// still\n`)]);
    const { compileFn } = fakeCompile([failed('first error'), failed('second error')]);
    const result = await makePart(engine, create, { compileFn });
    expect(requests).toHaveLength(2);
    expect(result).toEqual({
      ok: false,
      problem: 'compile',
      message: COMPILE_FAILED,
      code: `${broken}// still\n`,
      compileError: 'second error',
    });
  });

  it('repairs blocked code without compiling it first', async () => {
    const banned = 'minkowski() { cube(10); sphere(1); }\n';
    const blocked: EngineAnswer = { ok: false, problem: 'blocked', message: 'Use hull() instead.', code: banned, model: 'm' };
    const { engine, requests } = fakeEngine([blocked, code(good, 'm')]);
    const { compileFn, sources } = fakeCompile([passed]);
    const result = await makePart(engine, create, { compileFn });
    expect(result).toMatchObject({ ok: true, attempts: 2 });
    expect(sources).toEqual([good]);
    expect(requests[1]!.req).toMatchObject({ kind: 'repair', code: banned, error: 'Use hull() instead.' });
  });

  it('tells the model what a timeout means', async () => {
    const { engine, requests } = fakeEngine([code(broken), code(good)]);
    const { compileFn } = fakeCompile([failed(TIMEOUT_MESSAGE), passed]);
    await makePart(engine, create, { compileFn });
    expect(requests[1]!.req).toMatchObject({ error: expect.stringMatching(/simpler/) });
  });

  it('names an edit in the repair request', async () => {
    const edit: EngineRequest = { kind: 'edit', instruction: 'make it 10 mm wider', code: good };
    const { engine, requests } = fakeEngine([code(broken), code(good)]);
    const { compileFn } = fakeCompile([failed('oops'), passed]);
    await makePart(engine, edit, { compileFn });
    expect(requests[1]!.req).toMatchObject({ request: 'change the part: make it 10 mm wider' });
  });

  it('does not repair when the compiler itself failed to load', async () => {
    const { engine, requests } = fakeEngine([code(good)]);
    const { compileFn } = fakeCompile([failed(LOAD_MESSAGE)]);
    const result = await makePart(engine, create, { compileFn });
    expect(requests).toHaveLength(1);
    expect(result).toMatchObject({ ok: false, problem: 'compile', message: LOAD_MESSAGE, code: good });
  });

  it('passes an engine problem straight through', async () => {
    const { engine } = fakeEngine([{ ok: false, problem: 'rate-limit', message: 'Wait a minute.', model: 'm' }]);
    const { compileFn, sources } = fakeCompile([]);
    expect(await makePart(engine, create, { compileFn })).toEqual({ ok: false, problem: 'rate-limit', message: 'Wait a minute.' });
    expect(sources).toHaveLength(0);
  });

  it('keeps the first code when the repair request fails', async () => {
    const { engine } = fakeEngine([code(broken), { ok: false, problem: 'busy', message: 'Busy.' }]);
    const { compileFn } = fakeCompile([failed('first error')]);
    expect(await makePart(engine, create, { compileFn })).toEqual({
      ok: false,
      problem: 'busy',
      message: 'Busy.',
      code: broken,
      compileError: 'first error',
    });
  });

  it('stops without a repair when the compile is cancelled', async () => {
    const controller = new AbortController();
    const { engine, requests } = fakeEngine([code(good)]);
    const { compileFn } = fakeCompile([failed(CANCEL_MESSAGE)]);
    controller.abort();
    const result = await makePart(engine, create, { compileFn, signal: controller.signal });
    expect(result).toMatchObject({ ok: false, problem: 'cancelled' });
    expect(requests).toHaveLength(1);
  });

  it('passes the signal to the engine and the compiler', async () => {
    const controller = new AbortController();
    const { engine } = fakeEngine([code(good)]);
    const { compileFn } = fakeCompile([passed]);
    await makePart(engine, create, { compileFn, signal: controller.signal });
    expect(engine.run).toHaveBeenCalledWith(create, { model: undefined, signal: controller.signal });
    expect(compileFn).toHaveBeenCalledWith(good, {}, { signal: controller.signal });
  });
});
