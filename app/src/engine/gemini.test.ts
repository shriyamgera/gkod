import { afterEach, describe, expect, it, vi } from 'vitest';
import { answerText, createGeminiEngine, ENDPOINT, fallbackOrder, MESSAGES } from './gemini';

const KEY = 'AQ.fake-test-key';
const part = '// Width (mm)\nwidth = 40; // [20:1:80]\ncube([width, 20, 5]);';

type Call = { url: string; init: RequestInit; body: Record<string, unknown> };

const json = (status: number, data: unknown) =>
  new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } });

const answer = (text: string, model = 'gemini-3.1-flash-lite') =>
  json(200, {
    status: 'completed',
    model,
    steps: [
      { type: 'thought', signature: 'abc' },
      { type: 'model_output', content: [{ type: 'text', text }] },
    ],
  });

const busy = (model: string) =>
  json(503, { error: { message: `${model} is currently experiencing high demand.`, code: 'service_unavailable' } });

function fakeFetch(replies: ((call: Call) => Response | Promise<Response>)[]) {
  const calls: Call[] = [];
  const fetch = vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const call = { url: String(input), init, body: JSON.parse(String(init.body)) as Record<string, unknown> };
    calls.push(call);
    const reply = replies[calls.length - 1];
    if (!reply) throw new Error('no more replies');
    return reply(call);
  });
  return { fetch: fetch as unknown as typeof globalThis.fetch, calls };
}

function engine(replies: Parameters<typeof fakeFetch>[0], key: string | null = KEY, timeoutMs?: number) {
  const fake = fakeFetch(replies);
  const made = createGeminiEngine({ fetch: fake.fetch, getKey: () => key, getModel: () => 'gemini-3.1-flash-lite', timeoutMs });
  return { engine: made, calls: fake.calls };
}

afterEach(() => {
  vi.useRealTimers();
});

describe('gemini request', () => {
  it('sends the key only in the header, with store off and the chosen model', async () => {
    const { engine: gemini, calls } = engine([() => answer(`\`\`\`openscad\n${part}\n\`\`\``)]);
    const result = await gemini.run({ kind: 'create', prompt: 'A box' });
    expect(result).toMatchObject({ ok: true, code: `${part}\n`, model: 'gemini-3.1-flash-lite' });

    const [call] = calls;
    expect(call!.url).toBe(ENDPOINT);
    expect(call!.url).not.toContain(KEY);
    expect(call!.init.method).toBe('POST');
    const headers = call!.init.headers as Record<string, string>;
    expect(headers['x-goog-api-key']).toBe(KEY);
    expect(headers['content-type']).toBe('application/json');
    expect(String(call!.init.body)).not.toContain(KEY);
    expect(call!.body).toMatchObject({
      model: 'gemini-3.1-flash-lite',
      store: false,
      input: 'Make this part: A box',
      generation_config: { thinking_level: 'low' },
    });
    expect(call!.body.system_instruction).toMatch(/OpenSCAD/);
  });

  it('uses the model asked for over the default', async () => {
    const { engine: gemini, calls } = engine([() => answer(part, 'gemini-3-flash-preview')]);
    const result = await gemini.run({ kind: 'create', prompt: 'A box' }, { model: 'gemini-3-flash-preview' });
    expect(calls[0]!.body.model).toBe('gemini-3-flash-preview');
    expect(result).toMatchObject({ ok: true, model: 'gemini-3-flash-preview' });
  });

  it('sends a picture as an image part after the words', async () => {
    const { engine: gemini, calls } = engine([() => answer(part)]);
    const image = { mimeType: 'image/jpeg' as const, base64: 'QUJD', width: 8, height: 6 };
    await gemini.run({ kind: 'create', prompt: 'Bracket', image });
    const input = calls[0]!.body.input as { type: string }[];
    expect(input[0]).toMatchObject({ type: 'text', text: expect.stringMatching(/^Make this part: Bracket/) });
    expect(input[1]).toEqual({ type: 'image', data: 'QUJD', mime_type: 'image/jpeg' });
  });

  it('asks again without a thinking level when a model refuses one', async () => {
    const refused = () => json(400, { error: { message: 'thinking_level is not supported for this model.', code: 'invalid_request' } });
    const { engine: gemini, calls } = engine([refused, () => answer(part)]);
    const result = await gemini.run({ kind: 'create', prompt: 'A box' });
    expect(result.ok).toBe(true);
    expect(calls).toHaveLength(2);
    expect(calls[1]!.body.generation_config).toBeUndefined();
    expect(calls[1]!.body.model).toBe('gemini-3.1-flash-lite');
  });
});

describe('gemini answers', () => {
  it('reads only the text of model output steps', () => {
    const data = {
      steps: [
        { type: 'thought', signature: 'x', content: [{ type: 'text', text: 'hidden' }] },
        { type: 'model_output', content: [{ type: 'text', text: 'one ' }, { type: 'image', data: 'x' }] },
        { type: 'model_output', content: [{ type: 'text', text: 'two' }] },
      ],
    };
    expect(answerText(data)).toBe('one two');
    expect(answerText(null)).toBe('');
    expect(answerText({ steps: 'nope' })).toBe('');
  });

  it('reports an answer with no code', async () => {
    const { engine: gemini } = engine([() => answer('I cannot help with that.')]);
    expect(await gemini.run({ kind: 'create', prompt: 'A box' })).toMatchObject({
      ok: false,
      problem: 'no-code',
      model: 'gemini-3.1-flash-lite',
    });
  });

  it('passes back blocked code so it can be repaired', async () => {
    const banned = 'minkowski() { cube(10); sphere(1); }';
    const { engine: gemini } = engine([() => answer(`\`\`\`openscad\n${banned}\n\`\`\``)]);
    expect(await gemini.run({ kind: 'create', prompt: 'A box' })).toMatchObject({
      ok: false,
      problem: 'blocked',
      code: `${banned}\n`,
    });
  });
});

describe('gemini fallback', () => {
  it('lists the chosen model first, then the others in menu order', () => {
    expect(fallbackOrder('gemini-3.8-flash')).toEqual(['gemini-3.8-flash', 'gemini-3.1-flash-lite', 'gemini-3-flash-preview']);
    expect(fallbackOrder('gemini-3.1-flash-lite')).toEqual(['gemini-3.1-flash-lite', 'gemini-3-flash-preview', 'gemini-3.8-flash']);
  });

  it('moves to the next model on a busy reply and says which one answered', async () => {
    const { engine: gemini, calls } = engine([
      () => busy('gemini-3.8-flash'),
      () => answer(part),
    ]);
    const result = await gemini.run({ kind: 'create', prompt: 'A box' }, { model: 'gemini-3.8-flash' });
    expect(calls.map((call) => call.body.model)).toEqual(['gemini-3.8-flash', 'gemini-3.1-flash-lite']);
    expect(result).toMatchObject({ ok: true, model: 'gemini-3.1-flash-lite' });
  });

  it('reports busy once every model is busy', async () => {
    const { engine: gemini, calls } = engine([
      () => busy('a'),
      () => json(404, { error: { message: 'model not found', code: 'not_found' } }),
      () => busy('c'),
    ]);
    const result = await gemini.run({ kind: 'create', prompt: 'A box' });
    expect(calls).toHaveLength(3);
    expect(result).toEqual({ ok: false, problem: 'busy', message: MESSAGES.busy });
  });

  it('does not move on for a rate limit', async () => {
    const { engine: gemini, calls } = engine([
      () => json(429, { error: { message: 'Resource exhausted', code: 'resource_exhausted' } }),
    ]);
    const result = await gemini.run({ kind: 'create', prompt: 'A box' });
    expect(calls).toHaveLength(1);
    expect(result).toEqual({ ok: false, problem: 'rate-limit', message: MESSAGES.rateLimit, model: 'gemini-3.1-flash-lite' });
  });
});

describe('gemini errors', () => {
  it('asks for a key before calling Gemini', async () => {
    const { engine: gemini, calls } = engine([], null);
    expect(await gemini.run({ kind: 'create', prompt: 'A box' })).toEqual({
      ok: false,
      problem: 'no-key',
      message: MESSAGES.noKey,
    });
    expect(calls).toHaveLength(0);
  });

  it('refuses a key that cannot be sent in a header without calling Gemini', async () => {
    const { engine: gemini, calls } = engine([], 'AQ.has space');
    expect(await gemini.run({ kind: 'create', prompt: 'A box' })).toMatchObject({ problem: 'bad-key' });
    expect(calls).toHaveLength(0);
  });

  it.each([
    [401, [{ error: { code: 401, message: 'API key not valid. Please pass a valid API key.', status: 'UNAUTHENTICATED' } }]],
    [400, { error: { code: 400, message: 'API key not valid.', status: 'INVALID_ARGUMENT', details: [{ reason: 'API_KEY_INVALID' }] } }],
    [403, { error: { code: 403, message: 'Permission denied.', status: 'PERMISSION_DENIED' } }],
  ])('maps a %i key error to bad-key', async (status, body) => {
    const { engine: gemini } = engine([() => json(status, body)]);
    expect(await gemini.run({ kind: 'create', prompt: 'A box' })).toMatchObject({
      ok: false,
      problem: 'bad-key',
      message: MESSAGES.badKey,
    });
  });

  it('maps other request errors to other', async () => {
    const { engine: gemini } = engine([() => json(400, { error: { message: 'Bad input', code: 'invalid_request' } })]);
    expect(await gemini.run({ kind: 'create', prompt: 'A box' })).toMatchObject({ problem: 'other', message: MESSAGES.refused });
  });

  it('maps a failed connection to network', async () => {
    const { engine: gemini } = engine([
      () => {
        throw new TypeError('Failed to fetch');
      },
    ]);
    expect(await gemini.run({ kind: 'create', prompt: 'A box' })).toMatchObject({
      problem: 'network',
      message: MESSAGES.network,
    });
  });

  it('stops waiting after the time limit', async () => {
    vi.useFakeTimers();
    const hang = ({ init }: Call) =>
      new Promise<Response>((_, reject) => {
        init.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
      });
    const { engine: gemini } = engine([hang], KEY, 1000);
    const pending = gemini.run({ kind: 'create', prompt: 'A box' });
    await vi.advanceTimersByTimeAsync(1000);
    expect(await pending).toMatchObject({ problem: 'network', message: MESSAGES.timeout });
  });

  it('stops when the caller cancels', async () => {
    const controller = new AbortController();
    const hang = ({ init }: Call) =>
      new Promise<Response>((_, reject) => {
        init.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
        controller.abort();
      });
    const { engine: gemini } = engine([hang]);
    const result = await gemini.run({ kind: 'create', prompt: 'A box' }, { signal: controller.signal });
    expect(result).toMatchObject({ ok: false, problem: 'cancelled' });
  });

  describe('while the answer is still arriving', () => {
    // The headers are in, the body is not. As with a real fetch, aborting the request errors the body.
    const slowBody = ({ init }: Call) => {
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new TextEncoder().encode('{"steps":[{"type":"model_output","content":['));
          init.signal?.addEventListener('abort', () => controller.error(new DOMException('Aborted', 'AbortError')));
        },
      });
      return new Response(stream, { status: 200, headers: { 'content-type': 'application/json' } });
    };

    it('reports Stop as cancelled', async () => {
      const controller = new AbortController();
      const { engine: gemini } = engine([
        (call) => {
          setTimeout(() => controller.abort(), 10);
          return slowBody(call);
        },
      ]);
      const result = await gemini.run({ kind: 'create', prompt: 'A box' }, { signal: controller.signal });
      expect(result).toMatchObject({ ok: false, problem: 'cancelled', message: MESSAGES.cancelled });
    });

    it('reports the time limit as too slow', async () => {
      const { engine: gemini } = engine([slowBody], KEY, 30);
      expect(await gemini.run({ kind: 'create', prompt: 'A box' })).toMatchObject({ problem: 'network', message: MESSAGES.timeout });
    });

    it('reports a body that cannot be read as a network problem', async () => {
      const { engine: gemini } = engine([() => new Response('{"steps": [', { status: 200 })]);
      expect(await gemini.run({ kind: 'create', prompt: 'A box' })).toMatchObject({ problem: 'network', message: MESSAGES.network });
    });
  });

  it('does not call Gemini when already cancelled', async () => {
    const controller = new AbortController();
    controller.abort();
    const { engine: gemini, calls } = engine([]);
    const result = await gemini.run({ kind: 'create', prompt: 'A box' }, { signal: controller.signal });
    expect(result).toMatchObject({ ok: false, problem: 'cancelled' });
    expect(calls).toHaveLength(0);
  });
});
