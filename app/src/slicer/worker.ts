/// <reference lib="webworker" />
import { createGcodeChecker, createLineSplitter, DEFAULT_ALLOWED, type GcodeReport, limits, PLA_LIMITS } from '@gkod/checks';
import { LOAD_MESSAGE, SLICE_MESSAGE, type SliceReply, type SliceRequest, TOO_BIG_MESSAGE, TOO_TALL_MESSAGE, UNSAFE_MESSAGE } from './messages';
import { createPostProcessor, kiriExtrudeAbs } from './postprocess';
import { printerFacts } from './printers';
import { kiriProcess } from './process';
import { LAYER_MM } from './types';

type Vec = { x: number; y: number; z: number };
type KiriSettings = { device: object; process: object };
type KiriMessage = { slice?: { update?: number }; prepare?: { update?: number } };
type KiriEngine = {
  settings: KiriSettings;
  widget: { getBoundingBox(): { min: Vec; max: Vec } };
  parse(data: ArrayBuffer): Promise<unknown>;
  setListener(listener: (message: KiriMessage) => void): unknown;
  setDevice(device: object): unknown;
  setProcess(process: object): unknown;
  slice(): Promise<unknown>;
  prepare(): Promise<unknown>;
};
type KiriExport = { time?: number; distance?: number };
type KiriModule = {
  Engine: new (paths: { workURL: string; poolURL: string }) => KiriEngine;
  client: {
    export(settings: KiriSettings, online: (segment: unknown) => void, done: (output: KiriExport | null, error?: unknown) => void): void;
  };
};

const scope = self as unknown as DedicatedWorkerGlobalScope;
const kiriUrl = new URL(`${import.meta.env.BASE_URL}kiri/`, scope.location.href);

// Kiri's page bundle reads the name `document` while it loads. A worker has no document; the name alone is enough.
(scope as unknown as { document?: undefined }).document = undefined;
patchStorage();

// Kiri awaits this call while it loads, and WebKit private windows reject it. Kiri only uses it for its own file cache.
function patchStorage() {
  const storage = scope.navigator.storage as unknown as { getDirectory?: () => Promise<unknown> } | undefined;
  if (!storage) return;
  const real = storage.getDirectory?.bind(storage);
  storage.getDirectory = () =>
    new Promise((resolve) => {
      const timer = setTimeout(() => resolve(undefined), 2000);
      const done = (value: unknown) => {
        clearTimeout(timer);
        resolve(value);
      };
      (real ? real() : Promise.resolve(undefined)).then(done, () => done(undefined));
    });
}

let loading: Promise<KiriModule> | null = null;

function load(): Promise<KiriModule> {
  loading ??= import(/* @vite-ignore */ new URL('kiri-eng.js', kiriUrl).href) as Promise<KiriModule>;
  loading.catch(() => {
    loading = null;
  });
  return loading;
}

// Kiri keeps its defaults in shared objects that each slice would change, so every slice starts from a copy.
let pristine: KiriSettings | null = null;

function newEngine(kiri: KiriModule): KiriEngine {
  const engine = new kiri.Engine({
    workURL: new URL('kiri-work.js', kiriUrl).href,
    poolURL: new URL('kiri-pool.js', kiriUrl).href,
  });
  pristine ??= structuredClone({ device: engine.settings.device, process: engine.settings.process });
  engine.settings.device = structuredClone(pristine.device);
  engine.settings.process = structuredClone(pristine.process);
  return engine;
}

// G-code is kept as Blobs of a few MB each, never as one string.
function createOutput() {
  const parts: Blob[] = [];
  let lines: string[] = [];
  let size = 0;
  function flush() {
    if (!lines.length) return;
    lines.push('');
    parts.push(new Blob([lines.join('\n')]));
    lines = [];
    size = 0;
  }
  return {
    push(line: string) {
      lines.push(line);
      size += line.length + 1;
      if (size > 4_000_000) flush();
    },
    finish(): Blob {
      flush();
      return new Blob(parts, { type: 'text/x-gcode' });
    },
  };
}

const reply = (message: SliceReply) => scope.postMessage(message);

function progressFor(id: number) {
  let last = 0;
  return (fraction: number) => {
    if (fraction - last < 0.01) return;
    last = fraction;
    reply({ type: 'progress', id, fraction: Math.min(1, fraction) });
  };
}

async function handle({ id, stl, settings }: SliceRequest): Promise<void> {
  let kiri: KiriModule;
  try {
    kiri = await load();
  } catch (thrown) {
    reply({ type: 'done', id, ok: false, error: LOAD_MESSAGE, detail: describe(thrown) });
    return;
  }
  reply({ type: 'start', id });
  let safety: GcodeReport | undefined;
  try {
    const facts = printerFacts(settings.printerId);
    if (!facts) throw new RangeError(`Unknown printer: ${settings.printerId}`);
    const process = kiriProcess(settings);
    const progress = progressFor(id);
    const engine = newEngine(kiri);
    engine.setListener((message) => {
      if (message.slice?.update !== undefined) progress(0.05 + 0.45 * message.slice.update);
      else if (message.prepare?.update !== undefined) progress(0.5 + 0.3 * message.prepare.update);
    });
    await engine.parse(stl);
    const { min, max } = engine.widget.getBoundingBox();
    const size = { x: max.x - min.x, y: max.y - min.y, z: max.z - min.z };
    // the same space and slack as the print checks' "Fits your printer"
    const over = (side: 'x' | 'y' | 'z') => size[side] > facts.printable[side] + limits.FIT_SLACK_MM;
    if (over('x') || over('y') || over('z')) {
      reply({ type: 'done', id, ok: false, error: over('x') || over('y') ? TOO_BIG_MESSAGE : TOO_TALL_MESSAGE });
      return;
    }
    engine.setDevice(facts.device);
    engine.setProcess(process);
    progress(0.05);
    await engine.slice();
    await engine.prepare();

    const expected = Math.max(1, Math.ceil((size.z - process.firstSliceHeight) / LAYER_MM[settings.quality]) + 1);
    const output = createOutput();
    const checker = createGcodeChecker({ bed: facts.bed, ...PLA_LIMITS, allowed: DEFAULT_ALLOWED });
    const post = createPostProcessor({ extrudeAbs: kiriExtrudeAbs(facts.device) }, (line) => {
      checker.line(line);
      output.push(line);
    });
    // Kiri sends whole lines in batches; they are split as the printer splits them
    const split = createLineSplitter(post.line);
    const exported = await new Promise<KiriExport>((resolve, reject) => {
      kiri.client.export(
        engine.settings,
        (segment) => {
          if (typeof segment !== 'string' || segment === '') return;
          split.push(segment);
          split.end();
          progress(0.8 + 0.2 * Math.min(1, post.summary().layers / expected));
        },
        (result, error) => (result && !error ? resolve(result) : reject(error ?? new Error('no output'))),
      );
    });
    const summary = post.summary();
    safety = checker.finish();
    if (!summary.sawStart || !summary.sawEnd || summary.layers === 0) {
      throw new Error('the slicer output is missing its start code, end code or layers');
    }
    if (!safety.ok) {
      reply({ type: 'done', id, ok: false, error: UNSAFE_MESSAGE, safety });
      return;
    }
    reply({
      type: 'done',
      id,
      ok: true,
      gcode: output.finish(),
      seconds: exported.time ?? 0,
      filamentMm: exported.distance ?? 0,
      layers: summary.layers,
      safety,
    });
  } catch (thrown) {
    reply({ type: 'done', id, ok: false, error: SLICE_MESSAGE, detail: describe(thrown), ...(safety ? { safety } : {}) });
  }
}

function describe(thrown: unknown): string {
  return thrown instanceof Error ? thrown.message : String(thrown);
}

scope.onmessage = ({ data }: MessageEvent<SliceRequest>) => {
  void handle(data);
};

void load().catch(() => {});
