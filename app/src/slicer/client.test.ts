import type { GcodeReport } from '@gkod/checks';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CANCEL_MESSAGE,
  CRASH_MESSAGE,
  createSlicer,
  DEFAULT_TIMEOUT_MS,
  LOAD_MESSAGE,
  TIMEOUT_MESSAGE,
  UNSAFE_MESSAGE,
  type WorkerLike,
} from './client';
import type { SliceReply, SliceRequest } from './messages';
import type { SliceSettings } from './types';

const settings: SliceSettings = { printerId: 'anycubic-kobra-2-neo', quality: 'normal', infill: 15, supports: false };

function report(ok: boolean): GcodeReport {
  return {
    ok,
    problems: ok ? [] : [{ line: 9, text: 'M500', reason: 'M500 saves settings to the printer’s memory.' }],
    stats: { lines: 10, moves: 4, maxX: 120, maxY: 120, maxZ: 5, minZ: 0.2, nozzle: [205, 0], bed: [60, 0], fanOnLayer: 2, extruderMode: 'relative' },
  };
}

class FakeWorker implements WorkerLike {
  onmessage: ((event: MessageEvent<SliceReply>) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  requests: { message: SliceRequest; transfer: Transferable[] }[] = [];
  terminated = false;

  postMessage(message: SliceRequest, transfer: Transferable[]) {
    this.requests.push({ message, transfer });
  }
  terminate() {
    this.terminated = true;
  }
  send(reply: SliceReply) {
    this.onmessage?.({ data: reply } as MessageEvent<SliceReply>);
  }
  id() {
    return this.requests[this.requests.length - 1]!.message.id;
  }
  start() {
    this.send({ type: 'start', id: this.id() });
  }
  succeed(safety = report(true)) {
    const gcode = new Blob(['G28\n']);
    this.send({ type: 'done', id: this.id(), ok: true, gcode, seconds: 6000, filamentMm: 12400, layers: 50, safety });
  }
}

function setup() {
  const workers: FakeWorker[] = [];
  const slice = createSlicer(() => {
    const worker = new FakeWorker();
    workers.push(worker);
    return worker;
  });
  return { workers, slice };
}

const flush = () => vi.advanceTimersByTimeAsync(0);
const stl = () => new Uint8Array([1, 2, 3, 4]).buffer;

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe('slice', () => {
  it('sends a copy of the part and the settings, and returns the G-code with its numbers', async () => {
    const { workers, slice } = setup();
    const part = stl();
    const pending = slice(part, settings);
    await flush();
    const { message, transfer } = workers[0]!.requests[0]!;
    expect(message).toMatchObject({ type: 'slice', settings });
    expect(new Uint8Array(message.stl)).toEqual(new Uint8Array([1, 2, 3, 4]));
    expect(transfer).toEqual([message.stl]);
    expect(message.stl).not.toBe(part);
    expect(part.byteLength).toBe(4);
    workers[0]!.start();
    workers[0]!.succeed();
    const result = await pending;
    expect(result).toMatchObject({ ok: true, seconds: 6000, filamentMm: 12400, layers: 50 });
    if (result.ok) expect(await result.gcode.text()).toBe('G28\n');
  });

  it('passes progress on, ending at 1', async () => {
    const { workers, slice } = setup();
    const seen: number[] = [];
    const pending = slice(stl(), settings, { onProgress: (fraction) => seen.push(fraction) });
    await flush();
    workers[0]!.start();
    workers[0]!.send({ type: 'progress', id: workers[0]!.id(), fraction: 0.4 });
    workers[0]!.succeed();
    await pending;
    expect(seen).toEqual([0.4, 1]);
  });

  it('never returns G-code that failed the safety check', async () => {
    const { workers, slice } = setup();
    const pending = slice(stl(), settings);
    await flush();
    workers[0]!.start();
    workers[0]!.succeed(report(false));
    const result = await pending;
    expect(result).toMatchObject({ ok: false, error: UNSAFE_MESSAGE, safety: report(false) });
    expect(result).not.toHaveProperty('gcode');
  });

  it('passes on a failure from the worker with its safety report', async () => {
    const { workers, slice } = setup();
    const pending = slice(stl(), settings);
    await flush();
    workers[0]!.start();
    workers[0]!.send({ type: 'done', id: workers[0]!.id(), ok: false, error: UNSAFE_MESSAGE, safety: report(false) });
    expect(await pending).toMatchObject({ ok: false, error: UNSAFE_MESSAGE, safety: report(false) });
  });

  it('stops a slice that runs past the time limit and starts a new worker for the next one', async () => {
    const { workers, slice } = setup();
    const pending = slice(stl(), settings);
    await flush();
    workers[0]!.start();
    await vi.advanceTimersByTimeAsync(DEFAULT_TIMEOUT_MS - 1);
    expect(workers[0]!.terminated).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(await pending).toMatchObject({ ok: false, error: TIMEOUT_MESSAGE });
    expect(workers[0]!.terminated).toBe(true);
    const next = slice(stl(), settings, { timeoutMs: 500 });
    await flush();
    expect(workers).toHaveLength(2);
    workers[1]!.start();
    await vi.advanceTimersByTimeAsync(500);
    expect(await next).toMatchObject({ ok: false, error: TIMEOUT_MESSAGE });
  });

  it('does not count loading the slicer against the time limit, but gives up on a load that never ends', async () => {
    const { workers, slice } = setup();
    const pending = slice(stl(), settings, { timeoutMs: 1000 });
    await vi.advanceTimersByTimeAsync(59999);
    expect(workers[0]!.terminated).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(await pending).toMatchObject({ ok: false, error: LOAD_MESSAGE });
    expect(workers[0]!.terminated).toBe(true);
  });

  it('restarts the worker after a crash', async () => {
    const { workers, slice } = setup();
    const pending = slice(stl(), settings);
    await flush();
    workers[0]!.onerror?.({ preventDefault() {} } as ErrorEvent);
    expect(await pending).toMatchObject({ ok: false, error: CRASH_MESSAGE });
    expect(workers[0]!.terminated).toBe(true);
    void slice(stl(), settings);
    await flush();
    expect(workers).toHaveLength(2);
  });

  it('stops when asked, ending the worker, and does not start when already stopped', async () => {
    const { workers, slice } = setup();
    const stopper = new AbortController();
    const pending = slice(stl(), settings, { signal: stopper.signal });
    await flush();
    workers[0]!.start();
    stopper.abort();
    expect(await pending).toMatchObject({ ok: false, error: CANCEL_MESSAGE });
    expect(workers[0]!.terminated).toBe(true);
    expect(await slice(stl(), settings, { signal: stopper.signal })).toEqual({ ok: false, error: CANCEL_MESSAGE, ms: 0 });
    expect(workers).toHaveLength(1);
  });

  it('runs slices one at a time and ignores replies meant for another slice', async () => {
    const { workers, slice } = setup();
    const first = slice(stl(), settings);
    const second = slice(stl(), { ...settings, quality: 'fine' });
    await flush();
    expect(workers[0]!.requests).toHaveLength(1);
    workers[0]!.send({ type: 'done', id: 99, ok: false, error: 'not this one' });
    workers[0]!.start();
    workers[0]!.succeed();
    expect((await first).ok).toBe(true);
    await flush();
    expect(workers[0]!.requests[1]!.message.settings.quality).toBe('fine');
    workers[0]!.start();
    workers[0]!.succeed();
    expect((await second).ok).toBe(true);
  });
});
