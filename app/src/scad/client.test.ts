import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CRASH_MESSAGE, LOAD_MESSAGE, TIMEOUT_MESSAGE, createCompiler, type WorkerLike } from './client';
import phoneStand from './fixtures/phone_stand.param.json?raw';
import type { WorkerReply, WorkerRequest } from './messages';

class FakeWorker implements WorkerLike {
  onmessage: ((event: MessageEvent<WorkerReply>) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  requests: WorkerRequest[] = [];
  terminated = false;

  postMessage(message: WorkerRequest) {
    this.requests.push(message);
  }
  terminate() {
    this.terminated = true;
  }
  send(reply: WorkerReply) {
    this.onmessage?.({ data: reply } as MessageEvent<WorkerReply>);
  }
  last() {
    return this.requests[this.requests.length - 1]!;
  }
  start() {
    this.send({ type: 'start', id: this.last().id });
  }
  succeed() {
    const stl = new ArrayBuffer(134);
    this.send({ type: 'done', id: this.last().id, ok: true, stl, paramExport: phoneStand, log: [], ms: 12 });
  }
}

function setup() {
  const workers: FakeWorker[] = [];
  const compile = createCompiler(() => {
    const worker = new FakeWorker();
    workers.push(worker);
    return worker;
  });
  return { workers, compile };
}

const flush = () => vi.advanceTimersByTimeAsync(0);

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe('compile', () => {
  it('returns the mesh and the sizes, with changed values applied', async () => {
    const { workers, compile } = setup();
    const pending = compile('cube(1);', { width: 120 });
    await flush();
    expect(workers[0]!.last()).toMatchObject({ source: 'cube(1);', overrides: { width: 120 } });
    workers[0]!.start();
    workers[0]!.succeed();
    const result = await pending;
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.stl.byteLength).toBe(134);
    expect(result.params).toHaveLength(7);
    expect(result.params[0]).toMatchObject({ name: 'width', value: 120, min: 50, max: 160 });
    expect(result.ms).toBe(12);
  });

  it('rejects banned calls without starting a worker', async () => {
    const { workers, compile } = setup();
    const result = await compile('minkowski() { cube(1); sphere(1); }');
    expect(result).toMatchObject({ ok: false, error: expect.stringMatching(/minkowski/) });
    expect(workers).toHaveLength(0);
  });

  it('stops a compile that runs past the limit and uses a new worker for the next one', async () => {
    const { workers, compile } = setup();
    const slow = compile('for (i = [0:1e9]) cube(i);', {}, { timeoutMs: 500 });
    await flush();
    workers[0]!.start();
    await vi.advanceTimersByTimeAsync(499);
    expect(workers[0]!.terminated).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(await slow).toMatchObject({ ok: false, error: TIMEOUT_MESSAGE });
    expect(workers[0]!.terminated).toBe(true);

    const next = compile('cube(1);');
    await flush();
    expect(workers).toHaveLength(2);
    expect(workers[0]!.requests).toHaveLength(1);
    workers[1]!.start();
    workers[1]!.succeed();
    expect((await next).ok).toBe(true);
  });

  it('does not count loading time against the compile limit', async () => {
    const { workers, compile } = setup();
    const pending = compile('cube(1);', {}, { timeoutMs: 500 });
    await flush();
    await vi.advanceTimersByTimeAsync(5000);
    workers[0]!.start();
    workers[0]!.succeed();
    expect((await pending).ok).toBe(true);
  });

  it('tells the caller when the compiler has loaded and the compile begins', async () => {
    const { workers, compile } = setup();
    const onStart = vi.fn();
    const pending = compile('cube(1);', {}, { onStart });
    await flush();
    expect(onStart).not.toHaveBeenCalled();
    workers[0]!.start();
    expect(onStart).toHaveBeenCalledTimes(1);
    workers[0]!.succeed();
    await pending;
    expect(onStart).toHaveBeenCalledTimes(1);
  });

  it('gives up when the compiler never loads', async () => {
    const { workers, compile } = setup();
    const pending = compile('cube(1);');
    await vi.advanceTimersByTimeAsync(60000);
    expect(await pending).toMatchObject({ ok: false, error: LOAD_MESSAGE });
    expect(workers[0]!.terminated).toBe(true);
  });

  it('restarts the worker after a crash', async () => {
    const { workers, compile } = setup();
    const pending = compile('cube(1);');
    await flush();
    workers[0]!.onerror?.({ message: 'boom' } as ErrorEvent);
    expect(await pending).toMatchObject({ ok: false, error: CRASH_MESSAGE });
    expect(workers[0]!.terminated).toBe(true);

    const next = compile('cube(1);');
    await flush();
    expect(workers).toHaveLength(2);
    workers[1]!.start();
    workers[1]!.succeed();
    expect((await next).ok).toBe(true);
  });

  it('reports a new worker that fails to start instead of waiting for it', async () => {
    // as when the worker script is gone: each worker fires its error soon after it is made
    const compile = createCompiler(() => {
      const worker = new FakeWorker();
      setTimeout(() => worker.onerror?.({ message: 'worker script missing' } as ErrorEvent), 0);
      return worker;
    });
    const first = compile('cube(1);');
    await flush();
    expect(await first).toMatchObject({ error: CRASH_MESSAGE });
    await vi.advanceTimersByTimeAsync(1000);

    const second = compile('cube(1);');
    await vi.advanceTimersByTimeAsync(10);
    expect(await second).toMatchObject({ error: CRASH_MESSAGE });
  });

  it('passes on a failure reported by the compiler', async () => {
    const { workers, compile } = setup();
    const pending = compile('cube(;');
    await flush();
    workers[0]!.start();
    const log = ['ERROR: Parser error: syntax error in file /in.scad, line 1'];
    workers[0]!.send({ type: 'done', id: 1, ok: false, error: 'Line 1: Parser error: syntax error', log, ms: 4 });
    expect(await pending).toEqual({ ok: false, error: 'Line 1: Parser error: syntax error', log, ms: 4 });
    expect(workers).toHaveLength(1);
  });

  it('runs requests one at a time, in order', async () => {
    const { workers, compile } = setup();
    const first = compile('cube(1);');
    const second = compile('cube(2);');
    await flush();
    expect(workers[0]!.requests.map((r) => r.source)).toEqual(['cube(1);']);
    workers[0]!.start();
    workers[0]!.succeed();
    await first;
    await flush();
    expect(workers[0]!.requests.map((r) => r.source)).toEqual(['cube(1);', 'cube(2);']);
    workers[0]!.start();
    workers[0]!.succeed();
    expect((await second).ok).toBe(true);
  });
});
