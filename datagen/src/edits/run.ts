// One edit run: pairs from index 0 up until `count` are made, both sides compiled and B checked in parallel, written
// in index order so the same seed, source file and commit always give the same pairs.jsonl.
import { createHash } from 'node:crypto';
import { closeSync, mkdirSync, openSync, writeFileSync, writeSync } from 'node:fs';
import { join } from 'node:path';
import { compileScad, TIME_LIMIT_MS } from '../../../tools/src/compile.ts';
import { PRINTERS } from '../../../tools/src/printers.ts';
import type { Source } from '../git.ts';
import { buildSha256, label, type Labels, OVERHANG_DEG, PRINTER } from '../run.ts';
import { FN } from '../serialize.ts';
import { diffSizes } from './build.ts';
import { KINDS, type EditKind } from './ops.ts';
import { type Pair, type PlannedPair, planPair } from './pair.ts';
import type { Avoid, Sources } from './source.ts';

export type EditLabels = Labels & {
  /** code A still compiles with the pinned build */
  a_compile_ok: boolean;
  /**
   * the compiler's sizes for code A and code B differ by exactly the changed, added and removed sizes, and every other
   * size has the same name, value and caption in both
   */
  sizes_ok: boolean | null;
};

export type EditRow = Pair & { labels: EditLabels };

export const SAME_EDIT = 'The same edit of the same part was already made earlier in this run.';

type Done = { index: number; row?: EditRow; skip?: PlannedPair['skip']; ms?: { compile_a: number; compile_b: number; check: number } };

const round = (value: number, places: number) => Number(value.toFixed(places));
const sha256 = (data: string | Uint8Array) => createHash('sha256').update(data).digest('hex');

type SizeLine = { name: string; value: number; caption?: string };

/** The compiler's size lists for A and B against the facts: only the named sizes differ, and nothing else at all. */
export function sizesMatch(a: SizeLine[], b: SizeLine[], facts: Pair['facts']): boolean {
  const diff = diffSizes(a, b);
  const same = (x: unknown, y: unknown) => JSON.stringify(x) === JSON.stringify(y);
  const captions = new Map(a.map((p) => [p.name, p.caption]));
  return (
    same(diff.changed, facts.changed) &&
    same(diff.added, facts.added) &&
    same(diff.removed, facts.removed) &&
    same(diff.kept, facts.kept) &&
    b.every((p) => !diff.kept.some((k) => k.name === p.name) || captions.get(p.name) === p.caption)
  );
}

/** Compiles code A for its size list and labels code B as the parts generator labels a part. */
export async function labelPair(planned: PlannedPair): Promise<Done> {
  if (!planned.pair) return { index: planned.index, skip: planned.skip };
  const pair = planned.pair;
  const [a, b] = await Promise.all([
    compileScad(pair.a.code),
    label({
      index: planned.index,
      params: planned.params!,
      row: {
        id: pair.id,
        index: pair.index,
        generator: pair.generator,
        seed: pair.seed,
        part_seed: pair.pair_seed,
        family: pair.family,
        tree: pair.b.tree,
        tree_sha256: pair.b.tree_sha256,
        title: pair.b.title,
        request: pair.instruction,
        facts: planned.meshFacts!,
        code: pair.b.code,
      },
    }),
  ]);
  const labels = b.row!.labels;
  // params_ok says B's compiled sizes are exactly the written block, so the written block stands for B here
  const sizes = a.ok && labels.params_ok ? sizesMatch(a.params, planned.params!, pair.facts) : null;
  return {
    index: planned.index,
    row: { ...pair, labels: { ...labels, a_compile_ok: a.ok, sizes_ok: sizes } },
    ms: { compile_a: round(a.ms, 1), compile_b: b.ms!.compile, check: b.ms!.check },
  };
}

export type EditManifest = {
  generator: Source;
  seed: number;
  count: number;
  rows: number;
  skipped: number;
  skip_reasons: Record<string, number>;
  source: { path: string; sha256: string; rows: number; commits: string[]; parts_used: number };
  avoid: { files: { path: string; sha256: string }[]; hashes: number };
  ops: Record<EditKind, number>;
  modes: { by: number; to: number };
  families: Record<string, number>;
  rates: { a_compile: number; compile: number; checks: number; params: number; facts: number; sizes: number };
  /** kept sizes across all pairs: every one has the same name and value in code A and code B */
  sizes: { kept: number; changed: number; added: number; removed: number };
  /** sha256 of the sorted edited-tree hashes, one per line, names the set of B parts */
  trees: { unique_b: number; sha256_b: string };
  settings: { printer: string; bed: { x: number; y: number; z: number }; overhang_deg: number; time_limit_ms: number; hardwarnings: true; fn: number };
  compiler: { wasm_sha256: string };
  files: Record<string, { rows: number; bytes: number; sha256: string }>;
};

export type EditRunOptions = {
  count: number;
  seed: number;
  out: string;
  workers: number;
  generator: Source;
  sources: Sources;
  avoid?: Avoid;
  progress?: (done: number) => void;
};

/** Writes pairs.jsonl, skipped.jsonl, timings.jsonl and manifest.json into `out`. */
export async function runEdits(opts: EditRunOptions): Promise<EditManifest> {
  const wasm = buildSha256();
  const avoid = opts.avoid ?? { hashes: new Set<string>(), files: [] };
  const clash = opts.sources.rows.find((row) => avoid.hashes.has(row.tree_sha256));
  if (clash) throw new Error(`Source part ${clash.id} is in an avoided file too, so the splits overlap.`);
  mkdirSync(opts.out, { recursive: true });
  const files = {
    pairs: openSync(join(opts.out, 'pairs.jsonl'), 'w'),
    skipped: openSync(join(opts.out, 'skipped.jsonl'), 'w'),
    timings: openSync(join(opts.out, 'timings.jsonl'), 'w'),
  };
  const hashes = { pairs: createHash('sha256'), skipped: createHash('sha256') };
  const sizes = { pairs: { rows: 0, bytes: 0 }, skipped: { rows: 0, bytes: 0 } };
  const ops = Object.fromEntries(KINDS.map((kind) => [kind, 0])) as Record<EditKind, number>;
  const modes = { by: 0, to: 0 };
  const families: Record<string, number> = {};
  const reasons: Record<string, number> = {};
  const totals = { a: 0, compiled: 0, passed: 0, params: 0, facts: 0, sizes: 0 };
  const counted = { kept: 0, changed: 0, added: 0, removed: 0 };
  const used = new Set<string>();
  const bTrees = new Set<string>();

  const write = (file: 'pairs' | 'skipped', value: unknown) => {
    const line = `${JSON.stringify(value)}\n`;
    writeSync(files[file], line);
    hashes[file].update(line);
    sizes[file].rows++;
    sizes[file].bytes += Buffer.byteLength(line);
  };

  const record = (done: Done) => {
    if (done.skip) {
      reasons[done.skip.reasons[0]!] = (reasons[done.skip.reasons[0]!] ?? 0) + 1;
      write('skipped', { index: done.index, ...done.skip });
      return;
    }
    const row = done.row!;
    ops[row.op.kind]++;
    if ('mode' in row.op) modes[row.op.mode]++;
    families[row.family] = (families[row.family] ?? 0) + 1;
    used.add(row.source.id);
    bTrees.add(row.b.tree_sha256);
    for (const key of ['kept', 'changed', 'added', 'removed'] as const) counted[key] += row.facts[key].length;
    const l = row.labels;
    if (l.a_compile_ok) totals.a++;
    if (l.compile.ok) totals.compiled++;
    if (l.checks?.ok) totals.passed++;
    if (l.params_ok) totals.params++;
    if (l.facts_ok) totals.facts++;
    if (l.sizes_ok) totals.sizes++;
    write('pairs', row);
    writeSync(files.timings, `${JSON.stringify({ index: done.index, ...done.ms })}\n`);
  };

  // Pairs are labelled in parallel but written strictly in index order.
  const finished = new Map<number, Done>();
  let next = 0;
  const flush = () => {
    while (finished.has(next)) {
      record(finished.get(next)!);
      finished.delete(next);
      next++;
      opts.progress?.(sizes.pairs.rows);
    }
  };
  // Each index is planned before the next one is handed out, so where a run stops never depends on the workers.
  const pairOptions = { seed: opts.seed, generator: opts.generator, sources: opts.sources.rows, fileSha256: opts.sources.sha256, avoid: avoid.hashes };
  let given = 0;
  let planned = 0;
  const seen = new Set<string>();
  const worker = async () => {
    while (planned < opts.count) {
      const index = given++;
      let pair = planPair(pairOptions, index);
      // the same edit of the same part made earlier in the run is skipped, so every row is a different pair
      const key = pair.pair && `${pair.pair.a.tree_sha256}>${pair.pair.b.tree_sha256}`;
      if (key && seen.has(key)) pair = { index, skip: { source: pair.pair!.source.id, family: pair.pair!.family, reasons: [SAME_EDIT] } };
      if (key && pair.pair) {
        seen.add(key);
        planned++;
      } else if (index + 1 - planned > Math.max(100, opts.count)) throw new Error('More pairs were skipped than made. Check the edits.');
      finished.set(index, await labelPair(pair));
      flush();
    }
  };
  try {
    await Promise.all(Array.from({ length: Math.max(1, opts.workers) }, worker));
  } finally {
    Object.values(files).forEach((fd) => closeSync(fd));
  }

  const rows = sizes.pairs.rows;
  const rate = (n: number) => (rows ? round(n / rows, 4) : 0);
  const manifest: EditManifest = {
    generator: opts.generator,
    seed: opts.seed,
    count: opts.count,
    rows,
    skipped: sizes.skipped.rows,
    skip_reasons: Object.fromEntries(Object.keys(reasons).sort().map((reason) => [reason, reasons[reason]!])),
    source: { path: opts.sources.path, sha256: opts.sources.sha256, rows: opts.sources.rows.length, commits: opts.sources.commits, parts_used: used.size },
    avoid: { files: avoid.files, hashes: avoid.hashes.size },
    ops,
    modes,
    families: Object.fromEntries(Object.keys(families).sort().map((family) => [family, families[family]!])),
    rates: {
      a_compile: rate(totals.a),
      compile: rate(totals.compiled),
      checks: rate(totals.passed),
      params: rate(totals.params),
      facts: rate(totals.facts),
      sizes: rate(totals.sizes),
    },
    sizes: counted,
    trees: { unique_b: bTrees.size, sha256_b: sha256([...bTrees].sort().map((hash) => `${hash}\n`).join('')) },
    settings: { printer: PRINTER, bed: PRINTERS[PRINTER]!.bed, overhang_deg: OVERHANG_DEG, time_limit_ms: TIME_LIMIT_MS, hardwarnings: true, fn: FN },
    compiler: { wasm_sha256: wasm },
    files: {
      'pairs.jsonl': { ...sizes.pairs, sha256: hashes.pairs.digest('hex') },
      'skipped.jsonl': { ...sizes.skipped, sha256: hashes.skipped.digest('hex') },
    },
  };
  writeFileSync(join(opts.out, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  return manifest;
}
