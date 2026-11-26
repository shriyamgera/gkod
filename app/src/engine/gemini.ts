import { extractCode } from './extract';
import { keyStore } from './keyStore';
import { SYSTEM_INSTRUCTION, userText } from './prompts';
import { engineSettings } from './settings';
import type { Engine, EngineAnswer, EngineProblem, EngineRequest, ModelChoice } from './types';

// New AI Studio keys only work with the Interactions API (see spikes/gemini-api).
export const ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/interactions';
export const TIMEOUT_MS = 90_000;

export const GEMINI_MODELS: ModelChoice[] = [
  { id: 'gemini-3.1-flash-lite', label: 'Gemini 3.1 Flash Lite', note: 'Fast' },
  { id: 'gemini-3-flash-preview', label: 'Gemini 3 Flash', note: 'Better, slower' },
  { id: 'gemini-3.8-flash', label: 'Gemini 3.8 Flash', note: 'Newest, often busy' },
];

export const MESSAGES = {
  noKey: 'Add your Gemini key to make a part.',
  badKey: 'Gemini did not accept this key. Check it and try again.',
  rateLimit: 'Your free key hit its limit. Wait a minute, or try another model.',
  // busy is only reported once every model on the menu has been tried
  busy: 'All Gemini models are busy right now. Try again in a minute.',
  missingModel: 'This model is not open to your key. Pick another model.',
  network: 'Could not reach Gemini. Check your connection and try again.',
  timeout: 'Gemini took too long to answer. Try again.',
  cancelled: 'Stopped.',
  refused: 'Gemini turned down this request. Try again, or say it another way.',
  other: 'Something went wrong while asking Gemini. Try again.',
} as const;

type Failure = { problem: EngineProblem; message: string; fallBack?: boolean; thinkingRejected?: boolean };

// When a model is busy the next one is tried: the chosen model first, then the rest in menu order.
export function fallbackOrder(chosen: string, models: ModelChoice[] = GEMINI_MODELS): string[] {
  return [chosen, ...models.map((model) => model.id).filter((id) => id !== chosen)];
}

export function buildBody(req: EngineRequest, model: string, thinking = true) {
  const text = userText(req);
  const input =
    req.kind === 'create' && req.image
      ? [
          { type: 'text', text },
          { type: 'image', data: req.image.base64, mime_type: req.image.mimeType },
        ]
      : text;
  return {
    model,
    system_instruction: SYSTEM_INSTRUCTION,
    input,
    store: false,
    ...(thinking ? { generation_config: { thinking_level: 'low' } } : {}),
  };
}

type Item = { type?: unknown; text?: unknown; content?: unknown };

const items = (value: unknown): Item[] =>
  Array.isArray(value) ? value.filter((item): item is Item => Boolean(item) && typeof item === 'object') : [];

// The answer is the text parts of the model_output steps; thought steps hold only a signature.
export function answerText(data: unknown): string {
  const steps = items((data as { steps?: unknown } | null)?.steps);
  return steps
    .filter((step) => step.type === 'model_output')
    .flatMap((step) => items(step.content))
    .filter((part) => part.type === 'text' && typeof part.text === 'string')
    .map((part) => part.text as string)
    .join('');
}

// Errors come as {error: {...}} or, for key errors, as [{error: {...}}].
function readError(data: unknown): { text: string; reason: string } {
  const body = Array.isArray(data) ? data[0] : data;
  const error = (body as { error?: Record<string, unknown> } | null)?.error ?? {};
  const details = items(error.details) as { reason?: unknown }[];
  const reason = details.map((detail) => detail.reason).find((value) => typeof value === 'string') ?? '';
  const parts = [error.message, error.status, error.code, reason].filter((part) => typeof part === 'string');
  return { text: parts.join(' '), reason: String(reason) };
}

export function classify(status: number, data: unknown): Failure {
  const { text, reason } = readError(data);
  if (status === 401 || status === 403 || /api.?key|ACCESS_TOKEN/i.test(`${text} ${reason}`)) {
    return { problem: 'bad-key', message: MESSAGES.badKey };
  }
  if (status === 429) return { problem: 'rate-limit', message: MESSAGES.rateLimit };
  if (status >= 500) return { problem: 'busy', message: MESSAGES.busy, fallBack: true };
  if (status === 404) return { problem: 'other', message: MESSAGES.missingModel, fallBack: true };
  if (status === 400 && /thinking/i.test(text)) {
    return { problem: 'other', message: MESSAGES.refused, thinkingRejected: true };
  }
  if (status === 400) return { problem: 'other', message: MESSAGES.refused };
  return { problem: 'other', message: MESSAGES.other };
}

type Deps = {
  fetch?: typeof fetch;
  getKey?: () => string | null;
  getModel?: () => string;
  timeoutMs?: number;
};

const validKey = /^[\x21-\x7e]+$/;

export function createGeminiEngine({
  fetch: send = (input, init) => globalThis.fetch(input, init),
  getKey = () => keyStore.get(),
  getModel = () => engineSettings.model(),
  timeoutMs = TIMEOUT_MS,
}: Deps = {}): Engine {
  async function ask(
    key: string,
    body: object,
    signal: AbortSignal | undefined,
  ): Promise<{ text: string } | Failure> {
    const controller = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, timeoutMs);
    const stop = () => controller.abort();
    signal?.addEventListener('abort', stop);
    try {
      const response = await send(ENDPOINT, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-goog-api-key': key },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      if (!response.ok) return classify(response.status, await response.json().catch(() => null));
      // a body cut off by Stop, the time limit or a dropped connection goes to the catch below
      const data: unknown = await response.json();
      return { text: answerText(data) };
    } catch {
      if (signal?.aborted) return { problem: 'cancelled', message: MESSAGES.cancelled };
      if (timedOut) return { problem: 'network', message: MESSAGES.timeout };
      return { problem: 'network', message: MESSAGES.network };
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', stop);
    }
  }

  async function run(req: EngineRequest, opts: { model?: string; signal?: AbortSignal } = {}): Promise<EngineAnswer> {
    const { signal } = opts;
    const key = getKey()?.trim();
    if (!key) return { ok: false, problem: 'no-key', message: MESSAGES.noKey };
    if (!validKey.test(key)) return { ok: false, problem: 'bad-key', message: MESSAGES.badKey };

    const began = performance.now();
    let last: Failure = { problem: 'busy', message: MESSAGES.busy };
    let sawBusy = false;
    for (const model of fallbackOrder(opts.model ?? getModel())) {
      if (signal?.aborted) return { ok: false, problem: 'cancelled', message: MESSAGES.cancelled };
      let reply = await ask(key, buildBody(req, model), signal);
      if ('thinkingRejected' in reply && reply.thinkingRejected) {
        reply = await ask(key, buildBody(req, model, false), signal);
      }
      if ('text' in reply) {
        const extracted = extractCode(reply.text);
        if (!extracted.ok) return { ...extracted, model };
        return { ok: true, code: extracted.code, model, ms: Math.round(performance.now() - began) };
      }
      if (!reply.fallBack) return { ok: false, problem: reply.problem, message: reply.message, model };
      last = reply;
      sawBusy ||= reply.problem === 'busy';
    }
    // every model was busy or not open to this key; "busy" is the more useful thing to report
    return sawBusy
      ? { ok: false, problem: 'busy', message: MESSAGES.busy }
      : { ok: false, problem: last.problem, message: last.message };
  }

  return { id: 'gemini', label: 'Gemini', models: GEMINI_MODELS, run };
}

export const gemini = createGeminiEngine();
