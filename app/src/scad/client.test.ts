import type { Report } from '@gkod/checks';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CANCEL_MESSAGE, CRASH_MESSAGE, LOAD_MESSAGE, TIMEOUT_MESSAGE, createCompiler, type WorkerLike } from './client';
import phoneStand from './fixtures/phone_stand.param.json?raw';
import type { CompileRequest, WorkerReply, WorkerRequest } from './messages';

class FakeWorker implements WorkerLike {
  onmessage: ((event: MessageEvent<WorkerReply>) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  requests: CompileRequest[] = [];
  cancels: number[] = [];
  terminated = false;

  postMessage(message: WorkerRequest) {
    if (message.type === 'cancel') this.cancels.push(message.id);
    else this.requests.push(message);
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
  succeed(checks?: Report) {
    const stl = new ArrayBuffer(134);
    const reply: WorkerReply = { type: 'done', id: this.last().id, ok: true, stl, paramExport: phoneStand, log: [], ms: 12 };
    this.send(checks ? { ...reply, checks } : reply);
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

  it('passes on the print checks made in the worker', async () => {
    const { workers, compile } = setup();
    const checks: Report = {
      ok: true,
      results: [{ id: 'closed', ok: true, title: 'Solid, no holes', detail: 'The surface is closed.' }],
      ms: 2.5,
      stats: { triangles: 12, volume: 1, size: [1, 1, 1], min: [0, 0, 0] },
    };
    const pending = compile('cube(1);');
    await flush();
    workers[0]!.start();
    workers[0]!.succeed(checks);
    const result = await pending;
    expect(result).toMatchObject({ ok: true, checks });

    const without = compile('cube(2);');
    await flush();
    workers[0]!.start();
    workers[0]!.succeed();
    expect(await without).not.toHaveProperty('checks');
  });

  it("sends the chosen printer's bed for the print checks, and none when not given", async () => {
    const { workers, compile } = setup();
    void compile('cube(1);', {}, { bed: { x: 220, y: 220, z: 250 } });
    await flush();
    expect(workers[0]!.last().bed).toEqual({ x: 220, y: 220, z: 250 });
    workers[0]!.start();
    workers[0]!.succeed();
    void compile('cube(2);');
    await flush();
    expect(workers[0]!.last()).not.toHaveProperty('bed');
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

  it('drops a cancelled compile that is still waiting for the compiler, without ending the worker', async () => {
    const { workers, compile } = setup();
    const controller = new AbortController();
    const pending = compile('cube(1);', {}, { signal: controller.signal });
    await flush();
    controller.abort();
    expect(workers[0]!.cancels).toEqual([workers[0]!.last().id]);
    workers[0]!.send({ type: 'cancelled', id: workers[0]!.last().id });
    expect(await pending).toMatchObject({ ok: false, error: CANCEL_MESSAGE });
    expect(workers[0]!.terminated).toBe(false);
  });

  it('ends the worker to stop a cancelled compile that is running, and uses a new one next', async () => {
    const { workers, compile } = setup();
    const controller = new AbortController();
    const pending = compile('slow();', {}, { signal: controller.signal });
    await flush();
    workers[0]!.start();
    controller.abort();
    expect(await pending).toMatchObject({ ok: false, error: CANCEL_MESSAGE });
    expect(workers[0]!.terminated).toBe(true);

    const next = compile('cube(1);');
    await flush();
    expect(workers).toHaveLength(2);
    workers[1]!.start();
    workers[1]!.succeed();
    expect((await next).ok).toBe(true);
  });

  it('ends the worker when the compile began just as it was cancelled', async () => {
    const { workers, compile } = setup();
    const controller = new AbortController();
    const onStart = vi.fn();
    const pending = compile('slow();', {}, { signal: controller.signal, onStart });
    await flush();
    controller.abort();
    workers[0]!.start();
    expect(await pending).toMatchObject({ error: CANCEL_MESSAGE });
    expect(workers[0]!.terminated).toBe(true);
    expect(onStart).not.toHaveBeenCalled();
  });

  it('skips a queued compile that is cancelled before its turn', async () => {
    const { workers, compile } = setup();
    const controller = new AbortController();
    const first = compile('cube(1);');
    const second = compile('cube(2);', {}, { signal: controller.signal });
    await flush();
    controller.abort();
    workers[0]!.start();
    workers[0]!.succeed();
    await first;
    expect(await second).toMatchObject({ error: CANCEL_MESSAGE });
    expect(workers[0]!.requests.map((r) => r.source)).toEqual(['cube(1);']);
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
