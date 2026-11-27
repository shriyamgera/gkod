// Makes a frozen set: the create pieces of every split, then the edit pairs inside each split, every row compiled and
// checked, written in a fixed order with a manifest and the sha256 of every file.
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { TIME_LIMIT_MS } from '../../../tools/src/compile.ts';
import { PRINTERS } from '../../../tools/src/printers.ts';
import { type PlannedPair } from '../edits/pair.ts';
import { type EditRow, labelPair } from '../edits/run.ts';
import { KINDS } from '../edits/ops.ts';
import type { Source } from '../git.ts';
import { buildSha256, label, type Labels, OVERHANG_DEG, PRINTER, type Row, treeHash } from '../run.ts';
import { FN } from '../serialize.ts';
import {
  COUNTS, type Counts, designProblems, FAMILY_SPLIT, featureTokens, HELD_OUT, LEVELS, NEAR_MM, type Pair, pairKey, SEEDS, SET_VERSION,
  type Split, SPLITS, type Tier, TIERS,
} from './design.ts';
import { type EditPlan, planEdits, planPiece, type PiecePlan, type PlannedPart } from './plan.ts';
import { createPieces, Ledger } from './rules.ts';
import { CHARS_PER_TOKEN, countTokens, createChars, editChars, type TokenCount } from './tokens.ts';

export type CreateRow = Row & { split: Split; tier: Exclude<Tier, 'edit'>; held_out_pair: Pair | null };
export type SetEditRow = EditRow & { split: Split; tier: 'edit'; source_tier: Exclude<Tier, 'edit'> };

export type Seeds = typeof SEEDS;

export type FileInfo = { rows: number; bytes: number; sha256: string };

export type SetManifest = {
  set: string;
  generator: Source;
  compiler: { wasm_sha256: string };
  settings: { printer: string; bed: { x: number; y: number; z: number }; overhang_deg: number; time_limit_ms: number; hardwarnings: true; fn: number };
  design: {
    families: Record<Split, readonly string[]>;
    levels: Record<string, string>;
    held_out_pairs: Record<'dev' | 'test', readonly Pair[]>;
    tiers: typeof TIERS;
    feature_tokens: string;
    near_copy_mm: number;
    rules: string[];
  };
  seeds: Seeds;
  counts: Record<Split, Record<string, number>>;
  families: Record<Split, Record<string, Record<string, number>>>;
  held_out: Record<'dev' | 'test', { pair: Pair; rows: number; train_parts_with: [number, number] }[]>;
  pieces: Record<string, { seed: number; rows: number; tried: number; skipped: Record<string, number>; ops?: Record<string, number>; source_tiers?: Record<string, number> }>;
  trees: Record<Split, { unique: number; sha256: string }> & { in_two_splits: number };
  tokens: { chars_per_token: number; create: TokenCount; edit: TokenCount; total: number };
  files: Record<string, FileInfo>;
};

export const RULES = [
  'Parts are split first, by family (tier 3) and by held-out feature pair (tier 2); edit pairs are made inside each split from its own parts.',
  'No tree appears in two splits, and no tree is within 0.5 mm of a tree of the same shape in another split (parts and both sides of every edit pair).',
  'Training parts and both sides of training edits have no held-out pair; dev rows have no test pair and test rows no dev pair.',
  'Tier 1 rows come from training families with their own seeds and have no held-out pair; tier 2 rows have exactly one of their split\'s pairs.',
  'Every row compiled with the pinned build, passed every print check, and its size block and stated sizes matched; a row that fails three times stops the run.',
];

const sha256 = (data: string | Uint8Array) => createHash('sha256').update(data).digest('hex');
const sorted = (counts: Record<string, number>) => Object.fromEntries(Object.keys(counts).sort().map((key) => [key, counts[key]!]));
const tally = <T>(items: T[], keyOf: (item: T) => string) => {
  const counts: Record<string, number> = {};
  for (const item of items) counts[keyOf(item)] = (counts[keyOf(item)] ?? 0) + 1;
  return sorted(counts);
};

/** Runs `work` on every item with at most `workers` at a time, and gives the results in the items' order. */
export async function pool<T, R>(items: readonly T[], workers: number, work: (item: T) => Promise<R>, done?: (n: number) => void): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  let finished = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await work(items[i]!);
      done?.(++finished);
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(workers, items.length)) }, worker));
  return results;
}

export const TRIES = 3;

function failed(labels: Labels & { a_compile_ok?: boolean; sizes_ok?: boolean | null }): string[] {
  const bad: string[] = [];
  if (!labels.compile.ok) bad.push('compile');
  if (!labels.checks?.ok) bad.push('checks');
  if (!labels.params_ok) bad.push('params_ok');
  if (!labels.facts_ok) bad.push('facts_ok');
  if (labels.a_compile_ok === false) bad.push('a_compile_ok');
  if ('sizes_ok' in labels && !labels.sizes_ok) bad.push('sizes_ok');
  return bad;
}

/**
 * Labels a planned part and returns its row. A part that fails a label is compiled again (a stalled machine can hit
 * the time limit); one that fails every try stops the run, so a frozen set never depends on the machine's speed.
 */
export async function labelPart(part: PlannedPart): Promise<Row> {
  for (let attempt = 1; ; attempt++) {
    const row = (await label(part)).row!;
    const bad = failed(row.labels);
    if (!bad.length) return row;
    if (attempt >= TRIES) throw new Error(`Part ${row.id} failed ${bad.join(', ')} ${TRIES} times, so the set was not made.`);
  }
}

export async function labelEdit(planned: PlannedPair): Promise<EditRow> {
  for (let attempt = 1; ; attempt++) {
    const row = (await labelPair(planned)).row!;
    const bad = failed(row.labels);
    if (!bad.length) return row;
    if (attempt >= TRIES) throw new Error(`Edit pair ${row.id} failed ${bad.join(', ')} ${TRIES} times, so the set was not made.`);
  }
}

function writeRows(out: string, path: string, rows: unknown[]): FileInfo {
  const text = rows.map((row) => `${JSON.stringify(row)}\n`).join('');
  const file = join(out, path);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, text);
  return { rows: rows.length, bytes: Buffer.byteLength(text), sha256: sha256(text) };
}

/** The lines of sets.sha256: each file's sha256 and its path in the set, as `shasum -a 256 -c` reads them. */
export function hashLines(files: Record<string, { sha256: string }>): string {
  return Object.keys(files).sort().map((path) => `${files[path]!.sha256}  ${path}\n`).join('');
}

export type MakeOptions = {
  out: string;
  workers: number;
  generator: Source;
  /** smaller counts for tests; the frozen set uses COUNTS */
  counts?: Counts;
  seeds?: Seeds;
  progress?: (line: string) => void;
};

/** Writes train/, dev/ and test/ (create.jsonl and edit.jsonl in each), manifest.json and sets.sha256 into `out`. */
export async function makeSets(opts: MakeOptions): Promise<SetManifest> {
  const problems = designProblems();
  if (problems.length) throw new Error(`The set design does not hold: ${problems.join(' ')}`);
  const counts = opts.counts ?? COUNTS;
  const seeds = opts.seeds ?? SEEDS;
  // read first, so a missing build stops the run before any file is written
  const wasm = buildSha256();
  if (existsSync(join(opts.out, 'manifest.json'))) throw new Error('The output folder already holds a set.');
  const say = opts.progress ?? (() => {});

  const ledger = new Ledger();
  const plans: PiecePlan[] = [];
  for (const piece of createPieces({ train: counts.train.create, ...counts.holdout }, { train: seeds.train.create, dev: seeds.dev, test: seeds.test })) {
    plans.push(planPiece(piece, ledger, opts.generator));
    say(`picked ${piece.split} ${piece.tier}: ${piece.count} parts`);
  }

  const files: Record<string, FileInfo> = {};
  const creates: Record<Split, CreateRow[]> = { train: [], dev: [], test: [] };
  for (const split of SPLITS) {
    const planned = plans.filter((p) => p.piece.split === split).flatMap((p) => p.parts.map((x) => ({ ...x, tier: p.piece.tier })));
    creates[split] = await pool(
      planned,
      opts.workers,
      async ({ part, pair, tier }): Promise<CreateRow> => {
        const { id, ...row } = await labelPart(part);
        return { id, split, tier, held_out_pair: pair, ...row };
      },
      (n) => n % 500 === 0 && say(`labelled ${split} parts: ${n} / ${planned.length}`),
    );
    files[`${split}/create.jsonl`] = writeRows(opts.out, `${split}/create.jsonl`, creates[split]);
  }

  const edits: Record<Split, SetEditRow[]> = { train: [], dev: [], test: [] };
  const editPlans = {} as Record<Split, EditPlan>;
  // test first, then dev, then train: each split's edited parts stay clear of every tree made before them, and the
  // ones made after them stay clear of theirs
  for (const split of ['test', 'dev', 'train'] as const) {
    const plan = planEdits({
      split,
      seed: seeds[split].edit,
      count: split === 'train' ? counts.train.edit : counts.holdout.edit,
      sources: creates[split],
      fileSha256: files[`${split}/create.jsonl`]!.sha256,
      ledger,
      generator: opts.generator,
    });
    editPlans[split] = plan;
    say(`picked ${split} edits: ${plan.pairs.length} pairs`);
    const tierOf = new Map(creates[split].map((row) => [row.id, row.tier]));
    edits[split] = await pool(
      plan.pairs,
      opts.workers,
      async (planned): Promise<SetEditRow> => {
        const { id, ...row } = await labelEdit(planned);
        return { id, split, tier: 'edit', source_tier: tierOf.get(row.source.id)!, ...row };
      },
      (n) => n % 500 === 0 && say(`labelled ${split} edits: ${n} / ${plan.pairs.length}`),
    );
    files[`${split}/edit.jsonl`] = writeRows(opts.out, `${split}/edit.jsonl`, edits[split]);
  }

  const manifest = manifestOf({ generator: opts.generator, wasm, seeds, plans, editPlans, creates, edits, files });
  const manifestText = `${JSON.stringify(manifest, null, 2)}\n`;
  writeFileSync(join(opts.out, 'manifest.json'), manifestText);
  const listed = { ...files, 'manifest.json': { sha256: sha256(manifestText) } };
  writeFileSync(join(opts.out, 'sets.sha256'), hashLines(listed));
  return manifest;
}

/** Every tree hash of a split: its parts and both sides of its edit pairs. */
export function treesOf(creates: { tree_sha256: string }[], edits: { a: { tree_sha256: string }; b: { tree_sha256: string } }[]): Set<string> {
  return new Set([...creates.map((r) => r.tree_sha256), ...edits.flatMap((r) => [r.a.tree_sha256, r.b.tree_sha256])]);
}

function manifestOf(m: {
  generator: Source;
  wasm: string;
  seeds: Seeds;
  plans: PiecePlan[];
  editPlans: Record<Split, EditPlan>;
  creates: Record<Split, CreateRow[]>;
  edits: Record<Split, SetEditRow[]>;
  files: Record<string, FileInfo>;
}): SetManifest {
  const counts = {} as SetManifest['counts'];
  const families = {} as SetManifest['families'];
  const pieces: SetManifest['pieces'] = {};
  for (const split of SPLITS) {
    counts[split] = {};
    families[split] = {};
    for (const p of m.plans.filter((plan) => plan.piece.split === split)) {
      const tier = p.piece.tier === 'train' ? 'create' : p.piece.tier;
      const rows = m.creates[split].filter((row) => row.tier === p.piece.tier);
      counts[split][tier] = rows.length;
      families[split][tier] = tally(rows, (row) => row.family);
      pieces[`${split}/${tier}`] = { seed: p.piece.seed, rows: rows.length, tried: p.tried, skipped: p.skipped };
    }
    const edits = m.edits[split];
    const plan = m.editPlans[split];
    counts[split].edit = edits.length;
    families[split].edit = tally(edits, (row) => row.family);
    pieces[`${split}/edit`] = {
      seed: plan.seed,
      rows: edits.length,
      tried: plan.tried,
      skipped: plan.skipped,
      ops: Object.fromEntries(KINDS.map((kind) => [kind, edits.filter((row) => row.op.kind === kind).length])),
      source_tiers: tally(edits, (row) => row.source_tier),
    };
  }

  const trainTokens = (token: string) => m.creates.train.filter((row) => featureTokens(row.tree).includes(token)).length;
  const heldOut = {} as SetManifest['held_out'];
  for (const split of ['dev', 'test'] as const) {
    heldOut[split] = HELD_OUT[split].map((pair) => ({
      pair,
      rows: m.creates[split].filter((row) => row.held_out_pair && pairKey(row.held_out_pair) === pairKey(pair)).length,
      train_parts_with: [trainTokens(pair[0]), trainTokens(pair[1])],
    }));
  }

  const sets = Object.fromEntries(SPLITS.map((split) => [split, treesOf(m.creates[split], m.edits[split])])) as Record<Split, Set<string>>;
  const seen = new Map<string, number>();
  for (const split of SPLITS) for (const hash of sets[split]) seen.set(hash, (seen.get(hash) ?? 0) + 1);
  const trees = {
    ...(Object.fromEntries(
      SPLITS.map((split) => [split, { unique: sets[split].size, sha256: sha256([...sets[split]].sort().map((hash) => `${hash}\n`).join('')) }]),
    ) as Record<Split, { unique: number; sha256: string }>),
    in_two_splits: [...seen.values()].filter((n) => n > 1).length,
  };

  const create = countTokens(m.creates.train.map(createChars));
  const edit = countTokens(m.edits.train.map(editChars));

  // every tree's hash is worked out again here, so a row can never carry a hash its tree does not have
  for (const split of SPLITS) {
    for (const row of m.creates[split]) if (treeHash(row.tree) !== row.tree_sha256) throw new Error(`${row.id} has a wrong tree hash.`);
    for (const row of m.edits[split]) {
      if (treeHash(row.a.tree) !== row.a.tree_sha256 || treeHash(row.b.tree) !== row.b.tree_sha256) throw new Error(`${row.id} has a wrong tree hash.`);
    }
  }

  return {
    set: SET_VERSION,
    generator: m.generator,
    compiler: { wasm_sha256: m.wasm },
    settings: { printer: PRINTER, bed: PRINTERS[PRINTER]!.bed, overhang_deg: OVERHANG_DEG, time_limit_ms: TIME_LIMIT_MS, hardwarnings: true, fn: FN },
    design: {
      families: FAMILY_SPLIT,
      levels: LEVELS,
      held_out_pairs: HELD_OUT,
      tiers: TIERS,
      feature_tokens: 'A feature is its kind, with its face for holes, slots and pockets (holes@top, slots@base); corner shapes and countersinks are not features.',
      near_copy_mm: NEAR_MM,
      rules: RULES,
    },
    seeds: m.seeds,
    counts,
    families,
    held_out: heldOut,
    pieces,
    trees,
    tokens: { chars_per_token: CHARS_PER_TOKEN, create, edit, total: create.tokens + edit.tokens },
    files: m.files,
  };
}
