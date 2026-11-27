import { findBannedCall } from '../scad/guard';
import { BRIDGE_URL } from './bridge';
import { MAX_CODE_BYTES } from './extract';
import { pairingStore } from './keyStore';
import { DEFAULT_CLAUDE_MODEL, engineSettings } from './settings';
import type { Engine, EngineAnswer, EngineProblem, EngineRequest, ModelChoice, RunOptions } from './types';

// The bridge stops a job after 300 seconds; this is only a safety net in case its answer never ends.
export const CLIENT_TIMEOUT_MS = 330_000;

// The bridge's limits (bridge/gkod_bridge/app.py): a request or change of at most MAX_WORDS characters, and room
// for the words a repair adds to it. The site checks the first itself, so nothing is turned down by the bridge.
export const MAX_WORDS = 4000;
const MAX_REPAIR_REQUEST = MAX_WORDS + 100;
const MAX_ERROR = 8000;

// Characters as the bridge counts them: one per code point, so an emoji counts once.
const characters = (text: string) => Array.from(text).length;
const clip = (text: string, max: number) => (characters(text) > max ? Array.from(text).slice(0, max).join('') : text);

// The typed words of a request or a change, which must fit the bridge's limit.
export function wordsTooLong(req: EngineRequest): boolean {
  if (req.kind === 'create') return characters(req.prompt) > MAX_WORDS;
  if (req.kind === 'edit') return characters(req.instruction) > MAX_WORDS;
  return false;
}

export const CLAUDE_MODELS: ModelChoice[] = [
  { id: 'sonnet', label: 'Sonnet', note: 'Faster' },
  { id: 'opus', label: 'Opus', note: 'Better, slower' },
];

export const CLAUDE_MESSAGES = {
  noPairing: 'Type the pairing code that the bridge shows in its terminal.',
  badPairing: 'The bridge did not accept this pairing code. Check the code in its terminal and try again.',
  noBridge: 'The GKod bridge is not answering on this Mac. Start it with bridge/.venv/bin/python -m gkod_bridge, then try again.',
  busy: 'Claude Code is already working on another part. Wait for it, or stop it.',
  cancelled: 'Stopped.',
  lost: 'The connection to the bridge was lost. Try again.',
  noCode: 'Claude Code did not send any OpenSCAD code. Try again, or say it another way.',
  tooLong: 'Claude Code sent more code than a part needs, so it was not used. Try again.',
  timeout: 'Claude Code took too long to answer. Try again.',
  tooManyWords: `Keep the request under ${MAX_WORDS} characters for Claude Code.`,
  other: 'Something went wrong while asking Claude Code. Try again.',
} as const;

type Event = { event: string; data: Record<string, unknown> };

// What the bridge is sent. A picture goes as plain base64; the bridge reads its type from the bytes.
export function requestBody(req: EngineRequest, model: string | undefined, session: string | undefined) {
  const common = { ...(model ? { model } : {}), ...(session ? { session_id: session } : {}) };
  switch (req.kind) {
    case 'create':
      return { kind: 'create', prompt: req.prompt, ...(req.image ? { image: req.image.base64 } : {}), ...common };
    case 'edit':
      return { kind: 'edit', instruction: req.instruction, code: req.code, ...common };
    case 'repair':
      // the error and the request are only context for the fix, so a long one is cut rather than turned down
      return { kind: 'repair', code: req.code, error: clip(req.error, MAX_ERROR), request: clip(req.request, MAX_REPAIR_REQUEST), ...common };
  }
}

// Server-Sent Events from a fetch body: blocks split by a blank line, with "event:" and "data:" lines.
// Comment lines (the bridge's keep-alives) are skipped.
export async function* readEvents(body: ReadableStream<Uint8Array>): AsyncGenerator<Event> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  try {
    while (true) {
      const { value, done } = await reader.read();
      buffer += decoder.decode(value, { stream: !done });
      buffer = buffer.replace(/\r\n?/g, '\n');
      let end = buffer.indexOf('\n\n');
      while (end !== -1) {
        const block = buffer.slice(0, end);
        buffer = buffer.slice(end + 2);
        const parsed = parseBlock(block);
        if (parsed) yield parsed;
        end = buffer.indexOf('\n\n');
      }
      if (done) break;
    }
  } finally {
    reader.releaseLock();
  }
}

function parseBlock(block: string): Event | null {
  let event = 'message';
  const data: string[] = [];
  for (const line of block.split('\n')) {
    if (line.startsWith(':')) continue;
    if (line.startsWith('event:')) event = line.slice(6).trim();
    else if (line.startsWith('data:')) data.push(line.slice(5).replace(/^ /, ''));
  }
  if (data.length === 0) return null;
  try {
    const parsed: unknown = JSON.parse(data.join('\n'));
    return parsed && typeof parsed === 'object' ? { event, data: parsed as Record<string, unknown> } : null;
  } catch {
    return null;
  }
}

const text = (value: unknown) => (typeof value === 'string' ? value : undefined);

// The bridge's own problems, in the site's words where they differ.
function bridgeProblem(problem: string): EngineProblem {
  if (problem === 'stopped') return 'cancelled';
  if (problem === 'no-code') return 'no-code';
  return 'other';
}

// Claude Code's answer gets the same checks as Gemini's: a size limit and the calls the site does not allow.
export function checkCode(code: string, model: string, session?: string, assumptions?: string): EngineAnswer {
  const clean = code.replace(/\r\n?/g, '\n').trim();
  const extra = { ...(session ? { session } : {}) };
  if (!clean) return { ok: false, problem: 'no-code', message: CLAUDE_MESSAGES.noCode, model, ...extra };
  if (new TextEncoder().encode(clean).length > MAX_CODE_BYTES) {
    return { ok: false, problem: 'too-long', message: CLAUDE_MESSAGES.tooLong, model, ...extra };
  }
  const final = `${clean}\n`;
  const banned = findBannedCall(final);
  if (banned) return { ok: false, problem: 'blocked', message: banned, code: final, model, ...extra };
  return { ok: true, code: final, model, ms: 0, ...extra, ...(assumptions ? { assumptions } : {}) };
}

type Deps = {
  fetch?: typeof fetch;
  getCode?: () => string | null;
  getModel?: () => string;
  base?: string;
  timeoutMs?: number;
};

export function createClaudeCodeEngine({
  fetch: send = (input, init) => globalThis.fetch(input, init),
  getCode = () => pairingStore.get(),
  getModel = () => engineSettings.model('claude-code'),
  base = BRIDGE_URL,
  timeoutMs = CLIENT_TIMEOUT_MS,
}: Deps = {}): Engine {
  async function run(req: EngineRequest, opts: RunOptions = {}): Promise<EngineAnswer> {
    const { signal, onProgress } = opts;
    const pairing = getCode()?.trim();
    if (!pairing) return { ok: false, problem: 'no-pairing', message: CLAUDE_MESSAGES.noPairing };
    if (wordsTooLong(req)) return { ok: false, problem: 'other', message: CLAUDE_MESSAGES.tooManyWords };
    const model = opts.model ?? getModel() ?? DEFAULT_CLAUDE_MODEL;
    const headers = { 'content-type': 'application/json', 'x-gkod-pairing': pairing };
    if (signal?.aborted) return { ok: false, problem: 'cancelled', message: CLAUDE_MESSAGES.cancelled };

    const began = performance.now();
    const controller = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, timeoutMs);
    // Stop closes the connection, which stops the job; /stop makes sure of it.
    const stop = () => {
      controller.abort();
      send(`${base}/stop`, { method: 'POST', headers: { 'x-gkod-pairing': pairing } }).catch(() => undefined);
    };
    signal?.addEventListener('abort', stop);
    let started = false;
    try {
      const response = await send(`${base}/run`, {
        method: 'POST',
        headers,
        body: JSON.stringify(requestBody(req, model, opts.session)),
        signal: controller.signal,
      });
      started = true;
      if (!response.ok) {
        const data = (await response.json().catch(() => null)) as { message?: unknown } | null;
        if (response.status === 401) return { ok: false, problem: 'bad-pairing', message: CLAUDE_MESSAGES.badPairing };
        if (response.status === 409) return { ok: false, problem: 'busy', message: CLAUDE_MESSAGES.busy };
        return { ok: false, problem: 'other', message: text(data?.message) ?? CLAUDE_MESSAGES.other };
      }
      if (!response.body) return { ok: false, problem: 'other', message: CLAUDE_MESSAGES.other };
      for await (const { event, data } of readEvents(response.body)) {
        if (event === 'progress') {
          const step = text(data.step);
          if (step) onProgress?.(step);
        } else if (event === 'final') {
          const reported = text(data.model) ?? `claude-${model}`;
          const session = text(data.session_id);
          const answer = checkCode(text(data.code) ?? '', reported, session, text(data.assumptions));
          return answer.ok ? { ...answer, ms: Math.round(performance.now() - began) } : answer;
        } else if (event === 'error') {
          const problem = text(data.problem) ?? 'failed';
          return { ok: false, problem: bridgeProblem(problem), message: text(data.message) ?? CLAUDE_MESSAGES.other, model };
        }
      }
      return { ok: false, problem: 'network', message: CLAUDE_MESSAGES.lost, model };
    } catch {
      if (signal?.aborted) return { ok: false, problem: 'cancelled', message: CLAUDE_MESSAGES.cancelled };
      if (timedOut) return { ok: false, problem: 'network', message: CLAUDE_MESSAGES.timeout, model };
      // no answer at all means no bridge; a cut-off answer means the connection dropped
      return started
        ? { ok: false, problem: 'network', message: CLAUDE_MESSAGES.lost, model }
        : { ok: false, problem: 'no-bridge', message: CLAUDE_MESSAGES.noBridge };
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', stop);
    }
  }

  return { id: 'claude-code', label: 'Claude Code', models: CLAUDE_MODELS, run };
}

export const claudeCode = createClaudeCodeEngine();
