import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CANCEL_MESSAGE, TIMEOUT_MESSAGE, type CompileOptions } from '../scad/client';
import type { CompileResult } from '../scad/types';
import { createLiveCompile, type LiveState, type Sizes } from './liveCompile';

type Call = { sizes: Sizes; opts: CompileOptions; resolve: (result: CompileResult) => void };

const good = (width: number): CompileResult => ({
  ok: true,
  stl: new ArrayBuffer(84),
  params: [{ name: 'width', value: width, min: 50, max: 160, step: 1 }],
  log: [],
  ms: 8,
});
const bad = (error: string): CompileResult => ({ ok: false, error, log: [], ms: 4 });

function setup(ready = false) {
  const calls: Call[] = [];
  const states: LiveState[] = [];
  const engine = { ready };
  const live = createLiveCompile({
    source: 'cube(width);',
    // like the real compiler, a cancelled compile resolves at once
    compile: (_source, sizes, opts) =>
      new Promise((resolve) => {
        calls.push({ sizes, opts, resolve });
        opts.signal?.addEventListener('abort', () => resolve(bad(CANCEL_MESSAGE)));
      }),
    onChange: (state) => states.push(state),
    engine,
  });
  const last = () => states[states.length - 1]!;
  // the compiler loads, runs the latest call and answers
  const answer = async (result: CompileResult) => {
    const call = calls[calls.length - 1]!;
    call.opts.onStart?.();
    call.resolve(result);
    await vi.advanceTimersByTimeAsync(0);
  };
  return { calls, states, engine, live, last, answer };
}

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe('createLiveCompile', () => {
  it('says the engine is loading until the first compile starts', async () => {
    const { calls, engine, live, last } = setup();
    live.request({}, { now: true });
    expect(last().status).toBe('loading');
    calls[0]!.opts.onStart?.();
    expect(last().status).toBe('working');
    expect(engine.ready).toBe(true);
    calls[0]!.resolve(good(80));
    await vi.advanceTimersByTimeAsync(0);
    expect(last()).toMatchObject({ status: 'idle', problem: null });
    expect(last().shown?.params[0]?.value).toBe(80);
    expect(last().defaults?.[0]?.value).toBe(80);
  });

  it('skips the loading step once the engine is ready', () => {
    const { live, last } = setup(true);
    live.request({}, { now: true });
    expect(last().status).toBe('working');
  });

  it('waits for changes to settle and compiles only the last one', async () => {
    const { calls, live, last } = setup(true);
    live.request({ width: 81 });
    await vi.advanceTimersByTimeAsync(100);
    live.request({ width: 82 });
    await vi.advanceTimersByTimeAsync(100);
    live.request({ width: 83 });
    expect(last().status).toBe('working');
    expect(calls).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(150);
    expect(calls.map((call) => call.sizes)).toEqual([{ width: 83 }]);
  });

  it('drops a result when a newer change came in, and keeps the old model meanwhile', async () => {
    const { calls, live, last, answer } = setup(true);
    live.request({}, { now: true });
    await answer(good(80));

    live.request({ width: 90 }, { now: true });
    live.request({ width: 100 }, { now: true });
    expect(calls).toHaveLength(2);
    calls[1]!.resolve(good(90));
    await vi.advanceTimersByTimeAsync(0);
    expect(last().shown?.params[0]?.value).toBe(80);
    expect(last().status).toBe('working');

    expect(calls.map((call) => call.sizes)).toEqual([{}, { width: 90 }, { width: 100 }]);
    await answer(good(100));
    expect(last()).toMatchObject({ status: 'idle' });
    expect(last().shown?.params[0]?.value).toBe(100);
  });

  it('runs one compile at a time however many changes arrive', async () => {
    const { calls, live, answer } = setup(true);
    live.request({ width: 90 }, { now: true });
    for (let width = 91; width < 100; width++) live.request({ width }, { now: true });
    expect(calls).toHaveLength(1);
    await answer(good(90));
    expect(calls.map((call) => call.sizes)).toEqual([{ width: 90 }, { width: 99 }]);
  });

  it('keeps the last good model when a compile fails, and clears the problem on the next success', async () => {
    const { live, last, answer } = setup(true);
    live.request({}, { now: true });
    await answer(good(80));

    live.request({ width: 150 }, { now: true });
    await answer(bad('Line 3: Parser error: syntax error'));
    expect(last().problem).toEqual({ kind: 'error', message: 'Line 3: Parser error: syntax error' });
    expect(last().shown?.params[0]?.value).toBe(80);

    live.request({ width: 90 }, { now: true });
    await answer(good(90));
    expect(last().problem).toBeNull();
  });

  it('reports a timeout as its own kind of problem', async () => {
    const { live, last, answer } = setup(true);
    live.request({}, { now: true });
    await answer(bad(TIMEOUT_MESSAGE));
    expect(last().problem?.kind).toBe('timeout');
    expect(last().shown).toBeNull();
  });

  it('takes the starting sizes only from a compile with no changes', async () => {
    const { live, last, answer } = setup(true);
    live.request({ width: 120 }, { now: true });
    await answer(good(120));
    expect(last().defaults).toBeNull();
  });

  it('cancels an out-of-date compile that has run for a while, and runs the newest change next', async () => {
    const { calls, live, last, answer } = setup(true);
    live.request({}, { now: true });
    await answer(good(80));

    live.request({ width: 90 }, { now: true });
    await vi.advanceTimersByTimeAsync(2000);
    live.request({ width: 100 });
    expect(calls[1]!.opts.signal?.aborted).toBe(true);
    await vi.advanceTimersByTimeAsync(150);
    expect(calls.map((call) => call.sizes)).toEqual([{}, { width: 90 }, { width: 100 }]);
    expect(last()).toMatchObject({ status: 'working', problem: null });
    expect(last().shown?.params[0]?.value).toBe(80);

    await answer(good(100));
    expect(last()).toMatchObject({ status: 'idle', problem: null });
    expect(last().shown?.params[0]?.value).toBe(100);
  });

  it('lets a quick out-of-date compile finish, but cancels it if it is still running later', async () => {
    const { calls, live } = setup(true);
    live.request({ width: 90 }, { now: true });
    await vi.advanceTimersByTimeAsync(100);
    live.request({ width: 100 }, { now: true });
    expect(calls[0]!.opts.signal?.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(150);
    expect(calls[0]!.opts.signal?.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(50);
    expect(calls[0]!.opts.signal?.aborted).toBe(true);
    expect(calls.map((call) => call.sizes)).toEqual([{ width: 90 }, { width: 100 }]);
  });

  it('never cancels the compile of the latest change', async () => {
    const { calls, live } = setup(true);
    live.request({ width: 90 }, { now: true });
    await vi.advanceTimersByTimeAsync(5000);
    expect(calls[0]!.opts.signal?.aborted).toBe(false);
  });

  it('cancels its compile when the part is closed', async () => {
    const { calls, live } = setup(true);
    live.request({}, { now: true });
    await vi.advanceTimersByTimeAsync(1000);
    live.dispose();
    expect(calls[0]!.opts.signal?.aborted).toBe(true);
  });

  it('ignores results and pending changes after it is stopped', async () => {
    const { calls, states, live, answer } = setup(true);
    live.request({}, { now: true });
    live.request({ width: 90 });
    const seen = states.length;
    live.dispose();
    await answer(good(80));
    await vi.advanceTimersByTimeAsync(500);
    expect(states).toHaveLength(seen);
    expect(calls).toHaveLength(1);
  });
});
