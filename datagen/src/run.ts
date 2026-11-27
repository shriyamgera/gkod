// One generator run: trees, requests and code for part 0 to count - 1, compiled and checked in parallel, written in
// index order so the same seed and commit always give the same parts.jsonl.
import { createHash } from 'node:crypto';
import { closeSync, mkdirSync, openSync, readFileSync, writeFileSync, writeSync } from 'node:fs';
import { join } from 'node:path';
import { checkStl, type Report } from '@gkod/checks';
import { BUILD_DIR, compileScad, TIME_LIMIT_MS } from '../../tools/src/compile.ts';
import { PRINTERS } from '../../tools/src/printers.ts';
import { FAMILIES, sampleTree } from './families/index.ts';
import type { Source } from './git.ts';
import { modelOf } from './part.ts';
import type { Fact } from './phrases.ts';
import { compose } from './request.ts';
import { Rng } from './rng.ts';
import type { Param } from './scad.ts';
import { FN, serialize } from './serialize.ts';
import type { Tree } from './tree.ts';
import { validate } from './validate.ts';

export const PRINTER = 'kobra2neo';
export const OVERHANG_DEG = 45;

export type Labels = {
  compile: { ok: boolean; error: string | null; triangles: number };
  mesh: { size: number[]; min: number[]; volume: number } | null;
  checks: { ok: boolean; results: { id: string; ok: boolean; detail?: string }[] } | null;
  /** the compiler's own list of sizes, read with the site's rules, is the size block exactly */
  params_ok: boolean | null;
  /** every fact that names an axis matches the mesh's size along it */
  facts_ok: boolean | null;
  stl_sha256: string | null;
};

export type Row = {
  id: string;
  index: number;
  generator: Source;
  seed: number;
  part_seed: number;
  family: string;
  tree: Tree;
  title: string;
  request: string;
  facts: Fact[];
  code: string;
  labels: Labels;
};

type Planned = { index: number; row?: Omit<Row, 'labels'>; params?: Param[]; skip?: { family: string; reasons: string[] } };
type Done = { index: number; row?: Row; skip?: Planned['skip']; ms?: { compile: number; check: number } };

const round = (value: number, places: number) => Number(value.toFixed(places));
const sha256 = (data: string | Uint8Array) => createHash('sha256').update(data).digest('hex');

/** Everything about part `index` that needs no compiler. */
export function plan(seed: number, index: number, generator: Source): Planned {
  const part = new Rng(seed).child(index);
  const tree = sampleTree(part);
  const reasons = validate(tree);
  if (reasons.length) return { index, skip: { family: tree.family, reasons } };
  // the request has its own generator, so a change to the wording never changes the trees
  const request = compose(tree, modelOf(tree), part.child(2));
  const written = serialize(tree, request.title);
  if ('reason' in written) return { index, skip: { family: tree.family, reasons: [written.reason] } };
  return {
    index,
    params: written.params,
    row: {
      id: `s${seed}-${String(index).padStart(6, '0')}`,
      index,
      generator,
      seed,
      part_seed: part.seed,
      family: tree.family,
      tree,
      title: request.title,
      request: request.request,
      facts: request.facts,
      code: written.code,
    },
  };
}

const AXES = { x: 0, y: 1, z: 2 } as const;

function factsMatch(facts: Fact[], size: number[]): boolean {
  return facts.every((fact) => {
    if (!fact.axis) return true;
    const axes = fact.axis === 'xy' ? (['x', 'y'] as const) : [fact.axis];
    return axes.every((axis) => Math.abs(size[AXES[axis]]! - fact.value) <= 0.05);
  });
}

const SIZE_FIELDS = ['name', 'caption', 'value', 'min', 'step', 'max'] as const;

/** The compiler's list of sizes (it may carry options too) against the size block the generator wrote. */
function sameSizes(compiled: { [key: string]: unknown }[], written: Param[]): boolean {
  return (
    compiled.length === written.length &&
    compiled.every((param, i) => Object.keys(param).length === SIZE_FIELDS.length && SIZE_FIELDS.every((field) => param[field] === written[i]![field]))
  );
}

function summary(report: Report): Labels['checks'] {
  return {
    ok: report.ok,
    results: report.results.map((result) => (result.ok ? { id: result.id, ok: true } : { id: result.id, ok: false, detail: result.detail })),
  };
}

/** Compiles and checks one planned part. */
export async function label(planned: Planned): Promise<Done> {
  if (!planned.row) return { index: planned.index, skip: planned.skip };
  const result = await compileScad(planned.row.code);
  const started = performance.now();
  let labels: Labels;
  if (!result.ok || !result.stl) {
    labels = { compile: { ok: false, error: result.error, triangles: 0 }, mesh: null, checks: null, params_ok: null, facts_ok: null, stl_sha256: null };
  } else {
    const report = checkStl(result.stl, { bed: PRINTERS[PRINTER]!.bed, overhangDeg: OVERHANG_DEG });
    const size = report.stats.size.map((v) => round(v, 3));
    labels = {
      compile: { ok: true, error: null, triangles: result.triangles },
      mesh: { size, min: report.stats.min.map((v) => round(v, 3)), volume: round(report.stats.volume, 2) },
      checks: summary(report),
      params_ok: sameSizes(result.params, planned.params!),
      facts_ok: factsMatch(planned.row.facts, report.stats.size),
      stl_sha256: sha256(result.stl),
    };
  }
  return {
    index: planned.index,
    row: { ...planned.row, labels },
    ms: { compile: round(result.ms, 1), check: round(performance.now() - started, 1) },
  };
}

export type FamilyCounts = { rows: number; skipped: number; compiled: number; passed: number };

export type Manifest = {
  generator: Source;
  seed: number;
  count: number;
  rows: number;
  skipped: number;
  skip_reasons: Record<string, number>;
  families: Record<string, FamilyCounts>;
  rates: { compile: number; checks: number; params: number; facts: number };
  settings: { printer: string; bed: { x: number; y: number; z: number }; overhang_deg: number; time_limit_ms: number; hardwarnings: true; fn: number };
  compiler: { wasm_sha256: string };
  files: Record<string, { rows: number; bytes: number; sha256: string }>;
};

export type RunOptions = { count: number; seed: number; out: string; workers: number; generator: Source; progress?: (done: number) => void };

/** Writes parts.jsonl, skipped.jsonl, timings.jsonl and manifest.json into `out`. */
export async function run(opts: RunOptions): Promise<Manifest> {
  mkdirSync(opts.out, { recursive: true });
  const files = {
    parts: openSync(join(opts.out, 'parts.jsonl'), 'w'),
    skipped: openSync(join(opts.out, 'skipped.jsonl'), 'w'),
    timings: openSync(join(opts.out, 'timings.jsonl'), 'w'),
  };
  const hashes = { parts: createHash('sha256'), skipped: createHash('sha256') };
  const sizes = { parts: { rows: 0, bytes: 0 }, skipped: { rows: 0, bytes: 0 } };
  const families: Record<string, FamilyCounts> = {};
  for (const family of FAMILIES) families[family.id] = { rows: 0, skipped: 0, compiled: 0, passed: 0 };
  const reasons: Record<string, number> = {};
  const totals = { compiled: 0, passed: 0, params: 0, facts: 0 };

  const write = (file: 'parts' | 'skipped', value: unknown) => {
    const line = `${JSON.stringify(value)}\n`;
    writeSync(files[file], line);
    hashes[file].update(line);
    sizes[file].rows++;
    sizes[file].bytes += Buffer.byteLength(line);
  };

  const record = (done: Done) => {
    if (done.skip) {
      families[done.skip.family]!.skipped++;
      reasons[done.skip.reasons[0]!] = (reasons[done.skip.reasons[0]!] ?? 0) + 1;
      write('skipped', { index: done.index, family: done.skip.family, reasons: done.skip.reasons });
      return;
    }
    const row = done.row!;
    const counts = families[row.family]!;
    counts.rows++;
    if (row.labels.compile.ok) {
      counts.compiled++;
      totals.compiled++;
    }
    if (row.labels.checks?.ok) {
      counts.passed++;
      totals.passed++;
    }
    if (row.labels.params_ok) totals.params++;
    if (row.labels.facts_ok) totals.facts++;
    write('parts', row);
    writeSync(files.timings, `${JSON.stringify({ index: done.index, compile_ms: done.ms!.compile, check_ms: done.ms!.check })}\n`);
  };

  // Parts are labelled in parallel but written strictly in index order.
  const finished = new Map<number, Done>();
  let next = 0;
  let given = 0;
  const flush = () => {
    while (finished.has(next)) {
      record(finished.get(next)!);
      finished.delete(next);
      next++;
      opts.progress?.(next);
    }
  };
  const worker = async () => {
    while (given < opts.count) {
      const index = given++;
      finished.set(index, await label(plan(opts.seed, index, opts.generator)));
      flush();
    }
  };
  try {
    await Promise.all(Array.from({ length: Math.max(1, opts.workers) }, worker));
  } finally {
    Object.values(files).forEach((fd) => closeSync(fd));
  }

  const rows = sizes.parts.rows;
  const rate = (n: number) => (rows ? round(n / rows, 4) : 0);
  const manifest: Manifest = {
    generator: opts.generator,
    seed: opts.seed,
    count: opts.count,
    rows,
    skipped: sizes.skipped.rows,
    skip_reasons: Object.fromEntries(Object.keys(reasons).sort().map((reason) => [reason, reasons[reason]!])),
    families,
    rates: { compile: rate(totals.compiled), checks: rate(totals.passed), params: rate(totals.params), facts: rate(totals.facts) },
    settings: {
      printer: PRINTER,
      bed: PRINTERS[PRINTER]!.bed,
      overhang_deg: OVERHANG_DEG,
      time_limit_ms: TIME_LIMIT_MS,
      hardwarnings: true,
      fn: FN,
    },
    compiler: { wasm_sha256: sha256(readFileSync(new URL('openscad.wasm', BUILD_DIR))) },
    files: {
      'parts.jsonl': { ...sizes.parts, sha256: hashes.parts.digest('hex') },
      'skipped.jsonl': { ...sizes.skipped, sha256: hashes.skipped.digest('hex') },
    },
  };
  writeFileSync(join(opts.out, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  return manifest;
}
