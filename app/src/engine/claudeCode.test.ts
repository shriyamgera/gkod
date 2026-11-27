import { describe, expect, it, vi } from 'vitest';
import { CLAUDE_MESSAGES, checkCode, createClaudeCodeEngine, MAX_WORDS, readEvents, requestBody } from './claudeCode';
import type { EngineRequest } from './types';

const PART = '// Spacer length (mm)\nlength = 20; // [5:1:60]\ncylinder(h = length, d = 10, $fn = 64);\n';
const SESSION = '11111111-2222-4333-8444-555555555555';

function sse(events: [string, unknown][], comments = true): string {
  return events.map(([event, data]) => `${comments ? ': still working\n\n' : ''}event: ${event}\ndata: ${JSON.stringify(data)}\n\n`).join('');
}

// A body that arrives in small pieces, cut in odd places, like a real stream.
function streamOf(text: string, piece = 7): ReadableStream<Uint8Array> {
  const bytes = new TextEncoder().encode(text);
  let at = 0;
  return new ReadableStream({
    pull(controller) {
      if (at >= bytes.length) {
        controller.close();
        return;
      }
      controller.enqueue(bytes.slice(at, at + piece));
      at += piece;
    },
  });
}

type Call = { url: string; init?: RequestInit };

function fakeFetch(answer: (call: Call) => Response | Promise<Response>) {
  const calls: Call[] = [];
  const fn = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
    const call = { url: String(url), init };
    calls.push(call);
    return answer(call);
  });
  return { fetch: fn as unknown as typeof fetch, calls };
}

const streamed = (text: string) => new Response(streamOf(text), { status: 200, headers: { 'content-type': 'text/event-stream' } });

const good = sse([
  ['progress', { step: 'Writing the part' }],
  ['progress', { step: 'Compiling' }],
  ['progress', { step: 'Looking at the picture' }],
  [
    'final',
    { code: PART, assumptions: 'A 5.5 mm hole.', session_id: SESSION, resumed: false, model: 'claude-sonnet-5', ms: 41000, turns: 5 },
  ],
]);

const create: EngineRequest = { kind: 'create', prompt: 'Spacer for an M5 bolt' };

function engine(fetchFn: typeof fetch, code: string | null = 'ABCD-EFGH-JKMN') {
  return createClaudeCodeEngine({ fetch: fetchFn, getCode: () => code, getModel: () => 'sonnet', base: 'http://bridge.test' });
}

describe('requestBody', () => {
  it('sends what each kind needs', () => {
    const image = { mimeType: 'image/jpeg' as const, base64: '/9j/AAA=', width: 10, height: 10 };
    expect(requestBody({ kind: 'create', prompt: 'A box', image }, 'opus', undefined)).toEqual({
      kind: 'create',
      prompt: 'A box',
      image: '/9j/AAA=',
      model: 'opus',
    });
    expect(requestBody({ kind: 'edit', instruction: 'wider', code: PART }, 'sonnet', SESSION)).toEqual({
      kind: 'edit',
      instruction: 'wider',
      code: PART,
      model: 'sonnet',
      session_id: SESSION,
    });
    expect(requestBody({ kind: 'repair', code: PART, error: 'line 2', request: 'A box' }, undefined, SESSION)).toEqual({
      kind: 'repair',
      code: PART,
      error: 'line 2',
      request: 'A box',
      session_id: SESSION,
    });
  });
});

describe('readEvents', () => {
  it('reads events cut into pieces, skips keep-alives and handles CRLF', async () => {
    const text = 'event: progress\r\ndata: {"step":"Compiling"}\r\n\r\n: still working\r\n\r\nevent: final\r\ndata: {"code":"x"}\r\n\r\n';
    const events = [];
    for await (const event of readEvents(streamOf(text, 3))) events.push(event);
    expect(events).toEqual([
      { event: 'progress', data: { step: 'Compiling' } },
      { event: 'final', data: { code: 'x' } },
    ]);
  });
});

describe('Claude Code engine', () => {
  it('posts the request with the pairing code, reports each step and returns the code and session', async () => {
    const { fetch, calls } = fakeFetch(() => streamed(good));
    const steps: string[] = [];
    const answer = await engine(fetch).run(create, { onProgress: (step) => steps.push(step) });
    expect(answer).toMatchObject({ ok: true, code: PART, model: 'claude-sonnet-5', session: SESSION, assumptions: 'A 5.5 mm hole.' });
    expect(steps).toEqual(['Writing the part', 'Compiling', 'Looking at the picture']);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe('http://bridge.test/run');
    expect(calls[0]!.init?.method).toBe('POST');
    expect((calls[0]!.init?.headers as Record<string, string>)['x-gkod-pairing']).toBe('ABCD-EFGH-JKMN');
    expect(JSON.parse(String(calls[0]!.init?.body))).toEqual({ kind: 'create', prompt: 'Spacer for an M5 bolt', model: 'sonnet' });
  });

  it('continues a session when asked', async () => {
    const { fetch, calls } = fakeFetch(() => streamed(good));
    await engine(fetch).run({ kind: 'edit', instruction: 'make it 30 mm long', code: PART }, { session: SESSION, model: 'opus' });
    expect(JSON.parse(String(calls[0]!.init?.body))).toMatchObject({ session_id: SESSION, model: 'opus' });
  });

  it('asks for the pairing code before calling the bridge', async () => {
    const { fetch, calls } = fakeFetch(() => streamed(good));
    expect(await engine(fetch, null).run(create)).toEqual({ ok: false, problem: 'no-pairing', message: CLAUDE_MESSAGES.noPairing });
    expect(calls).toHaveLength(0);
  });

  it('says when the bridge turns the code down, is busy or refuses the request', async () => {
    const json = (status: number, body: object) => new Response(JSON.stringify(body), { status });
    const bad = await engine(fakeFetch(() => json(401, { error: 'pairing' })).fetch).run(create);
    expect(bad).toEqual({ ok: false, problem: 'bad-pairing', message: CLAUDE_MESSAGES.badPairing });
    const busy = await engine(fakeFetch(() => json(409, { error: 'busy' })).fetch).run(create);
    expect(busy).toMatchObject({ ok: false, problem: 'busy' });
    const big = await engine(fakeFetch(() => json(413, { message: 'The picture is over 4 MB.' })).fetch).run(create);
    expect(big).toEqual({ ok: false, problem: 'other', message: 'The picture is over 4 MB.' });
  });

  it('says plainly when no bridge answers', async () => {
    const { fetch } = fakeFetch(() => Promise.reject(new TypeError('Failed to fetch')));
    expect(await engine(fetch).run(create)).toEqual({ ok: false, problem: 'no-bridge', message: CLAUDE_MESSAGES.noBridge });
  });

  it('passes on the bridge’s plain error message', async () => {
    const message = 'Your Claude plan’s usage limit is reached. It resets at 15:00 on 27 Nov.';
    const { fetch } = fakeFetch(() => streamed(sse([['progress', { step: 'Writing the part' }], ['error', { problem: 'usage-limit', message }]])));
    expect(await engine(fetch).run(create)).toMatchObject({ ok: false, problem: 'other', message });
    const stopped = fakeFetch(() => streamed(sse([['error', { problem: 'stopped', message: 'Stopped.' }]])));
    expect(await engine(stopped.fetch).run(create)).toMatchObject({ ok: false, problem: 'cancelled' });
  });

  it('says the connection was lost when the stream ends without an answer', async () => {
    const { fetch } = fakeFetch(() => streamed(sse([['progress', { step: 'Compiling' }]])));
    expect(await engine(fetch).run(create)).toMatchObject({ ok: false, problem: 'network', message: CLAUDE_MESSAGES.lost });
  });

  it('checks the code like any other answer', async () => {
    const banned = 'minkowski() { cube(10); sphere(1); }\n';
    const { fetch } = fakeFetch(() => streamed(sse([['final', { code: banned, session_id: SESSION, model: 'claude-sonnet-5' }]])));
    const answer = await engine(fetch).run(create);
    expect(answer).toMatchObject({ ok: false, problem: 'blocked', code: banned, session: SESSION });
  });

  it('stops: the request is aborted and the bridge is told to stop', async () => {
    const controller = new AbortController();
    const { fetch, calls } = fakeFetch((call) => {
      if (call.url.endsWith('/stop')) return new Response('{"stopped":true}');
      return new Promise<Response>((_, reject) => {
        call.init?.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
      });
    });
    const running = engine(fetch).run(create, { signal: controller.signal });
    await Promise.resolve();
    controller.abort();
    expect(await running).toEqual({ ok: false, problem: 'cancelled', message: CLAUDE_MESSAGES.cancelled });
    expect(calls.map((call) => call.url)).toEqual(['http://bridge.test/run', 'http://bridge.test/stop']);
  });
});

describe('checkCode', () => {
  it('refuses empty and over-long code', () => {
    expect(checkCode('  ', 'm')).toMatchObject({ ok: false, problem: 'no-code' });
    expect(checkCode('x'.repeat(40_001), 'm')).toMatchObject({ ok: false, problem: 'too-long' });
    expect(checkCode('cube(1);\r\n', 'm')).toMatchObject({ ok: true, code: 'cube(1);\n' });
  });
});

describe('length limits', () => {
  it('turns down a request or change over the bridge’s limit before sending, in plain words', async () => {
    const { fetch, calls } = fakeFetch(() => streamed(good));
    const long = 'w'.repeat(MAX_WORDS + 1);
    const made = await engine(fetch).run({ kind: 'create', prompt: long });
    expect(made).toEqual({ ok: false, problem: 'other', message: 'Keep the request under 4000 characters for Claude Code.' });
    const changed = await engine(fetch).run({ kind: 'edit', instruction: long, code: PART });
    expect(changed.ok).toBe(false);
    expect(calls).toHaveLength(0);
  });

  it('counts characters as the bridge does, so the longest request still goes', async () => {
    const { fetch, calls } = fakeFetch(() => streamed(good));
    // an emoji is two UTF-16 units but one character
    const answer = await engine(fetch).run({ kind: 'create', prompt: '😀'.repeat(MAX_WORDS) });
    expect(answer.ok).toBe(true);
    expect(calls).toHaveLength(1);
  });

  it('cuts a long error or request in a repair to what the bridge takes', () => {
    const body = requestBody(
      { kind: 'repair', code: PART, error: 'e'.repeat(9000), request: `change the part: ${'w'.repeat(MAX_WORDS)}` },
      'sonnet',
      undefined,
    ) as { error: string; request: string };
    expect(body.error).toHaveLength(8000);
    expect(body.request).toHaveLength(MAX_WORDS + 17);
    const longer = requestBody({ kind: 'repair', code: PART, error: 'x', request: 'r'.repeat(5000) }, undefined, undefined) as { request: string };
    expect(longer.request).toHaveLength(MAX_WORDS + 100);
  });
});

