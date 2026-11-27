import { createHash } from 'node:crypto';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { SYSTEM_INSTRUCTION } from '../../app/src/engine/prompts.ts';
import { REPO } from '../src/git.ts';
import { treeHash } from '../src/run.ts';
import { checkSets } from '../src/splits/check.ts';
import { main, parseSetOptions, UsageError } from '../src/splits/cli.ts';
import { FAMILY_SPLIT, forbiddenPairs, HELD_OUT, pairsIn, SPLITS } from '../src/splits/design.ts';
import { type CreateRow, makeSets, type SetEditRow, type SetManifest } from '../src/splits/make.ts';
import { FROZEN, readSplit } from '../src/splits/read.ts';
import { answerOf, countTokens, createChars, editChars } from '../src/splits/tokens.ts';

const generator = { name: 'gkod-datagen', version: '0.1.0', commit: 'test', dirty: false };
const SMALL = { train: { create: 30, edit: 12 }, holdout: { t1: 4, t2: 4, t3: 3, edit: 3 } };
const FILES = ['train/create.jsonl', 'train/edit.jsonl', 'dev/create.jsonl', 'dev/edit.jsonl', 'test/create.jsonl', 'test/edit.jsonl'];

const dirs: string[] = [];
const fresh = () => {
  const dir = mkdtempSync(join(tmpdir(), 'gkod-sets-'));
  dirs.push(dir);
  return dir;
};
const rows = <T>(dir: string, file: string) => readFileSync(join(dir, file), 'utf8').trim().split('\n').map((line) => JSON.parse(line) as T);

let a: string;
let b: string;
let manifest: SetManifest;
beforeAll(async () => {
  [a, b] = [fresh(), fresh()];
  manifest = await makeSets({ out: a, workers: 4, generator, counts: SMALL });
  await makeSets({ out: b, workers: 1, generator, counts: SMALL });
}, 300000);
afterAll(() => dirs.forEach((dir) => rmSync(dir, { recursive: true, force: true })));

describe('making a set', () => {
  it('gives byte-identical files whatever the number of workers', () => {
    for (const file of [...FILES, 'manifest.json', 'sets.sha256']) expect(readFileSync(join(b, file), 'utf8'), file).toBe(readFileSync(join(a, file), 'utf8'));
  });

  it('writes the counts asked for, with split, tier and provenance on every row', () => {
    expect(manifest.counts).toEqual({
      train: { create: 30, edit: 12 },
      dev: { t1: 4, t2: 4, t3: 3, edit: 3 },
      test: { t1: 4, t2: 4, t3: 3, edit: 3 },
    });
    for (const split of SPLITS) {
      const creates = rows<CreateRow>(a, `${split}/create.jsonl`);
      const edits = rows<SetEditRow>(a, `${split}/edit.jsonl`);
      for (const row of [...creates, ...edits]) {
        expect(row.split).toBe(split);
        expect(row.generator).toEqual(generator);
        expect(Object.keys(row).slice(0, 3)).toEqual(['id', 'split', 'tier']);
      }
      for (const row of creates) {
        expect(treeHash(row.tree)).toBe(row.tree_sha256);
        expect(row.labels.compile.ok && row.labels.checks!.ok && row.labels.params_ok && row.labels.facts_ok).toBe(true);
        expect(pairsIn(row.tree, forbiddenPairs(split))).toEqual([]);
        if (row.tier === 't3') expect(FAMILY_SPLIT[split]).toContain(row.family);
        else expect(FAMILY_SPLIT.train).toContain(row.family);
        if (row.tier === 't2') expect(pairsIn(row.tree, HELD_OUT[split as 'dev' | 'test'])).toEqual([row.held_out_pair]);
        else expect(row.held_out_pair).toBeNull();
      }
      const ids = new Set(creates.map((row) => row.id));
      for (const row of edits) {
        expect(row.tier).toBe('edit');
        expect(ids.has(row.source.id)).toBe(true);
        expect(row.source_tier).toBe(creates.find((c) => c.id === row.source.id)!.tier);
        expect(row.source.file_sha256).toBe(manifest.files[`${split}/create.jsonl`]!.sha256);
        expect(pairsIn(row.b.tree, forbiddenPairs(split))).toEqual([]);
        expect(row.labels.sizes_ok && row.labels.a_compile_ok && row.labels.facts_ok).toBe(true);
      }
    }
    expect(manifest.trees.in_two_splits).toBe(0);
    expect(manifest.generator).toEqual(generator);
  });

  it('lists the sha256 of every file, and the manifest\'s own in sets.sha256', () => {
    const lines = readFileSync(join(a, 'sets.sha256'), 'utf8').trim().split('\n');
    expect(lines.map((line) => line.split('  ')[1])).toEqual([...FILES, 'manifest.json'].sort());
    for (const file of FILES) expect(lines).toContain(`${manifest.files[file]!.sha256}  ${file}`);
  });

  it('refuses a folder that already holds a set', async () => {
    await expect(makeSets({ out: a, workers: 1, generator, counts: SMALL })).rejects.toThrow(/already holds a set/);
  });

  it('counts tokens from the site\'s own prompt and message wording', () => {
    const creates = rows<CreateRow>(a, 'train/create.jsonl');
    const edits = rows<SetEditRow>(a, 'train/edit.jsonl');
    const one = createChars(creates[0]!);
    expect(one.system).toBe(SYSTEM_INSTRUCTION.length);
    expect(one.user).toBe(`Make this part: ${creates[0]!.request}`.length);
    expect(one.answer).toBe(answerOf(creates[0]!.code).length);
    expect(editChars(edits[0]!).user).toBeGreaterThan(edits[0]!.a.code.length + edits[0]!.instruction.length);
    expect(manifest.tokens.create).toEqual(countTokens(creates.map(createChars)));
    expect(manifest.tokens.edit.rows).toBe(12);
    expect(manifest.tokens.total).toBe(manifest.tokens.create.tokens + manifest.tokens.edit.tokens);
    expect(countTokens([{ system: 7, user: 0, answer: 0 }])).toMatchObject({ tokens: 2, tokens_without_system: 0 });
  });
});

describe('checking a set', () => {
  /** A copy of set a, changed by `edit`, with a hashes file for the files as they are then. */
  const copy = (edit: (dir: string) => void = () => {}, rehash = true) => {
    const dir = fresh();
    cpSync(a, dir, { recursive: true });
    edit(dir);
    const hashes = join(fresh(), 'sets.sha256');
    if (!rehash) writeFileSync(hashes, readFileSync(join(a, 'sets.sha256')));
    else {
      const lines = readFileSync(join(a, 'sets.sha256'), 'utf8').trim().split('\n').map((line) => line.split('  ')[1]!);
      writeFileSync(hashes, lines.map((path) => `${createHash('sha256').update(readFileSync(join(dir, path))).digest('hex')}  ${path}\n`).join(''));
    }
    return { dir, hashes };
  };

  it('passes a set that matches its hashes and its design', () => {
    const result = checkSets(a, join(a, 'sets.sha256'));
    expect(result.problems).toEqual([]);
    expect(result.ok).toBe(true);
    expect(result.done.join(' ')).toMatch(/All 7 files match/);
    expect(result.done.join(' ')).toMatch(/No tree is in two splits/);
  });

  it('fails a file that was changed after the hashes were taken', () => {
    const { dir, hashes } = copy((d) => writeFileSync(join(d, 'test/edit.jsonl'), readFileSync(join(d, 'test/edit.jsonl'), 'utf8').replace('"tier":"edit"', '"tier":"edit" ')), false);
    expect(checkSets(dir, hashes).problems).toContain('test/edit.jsonl does not match its committed sha256.');
  });

  it('fails a set with an extra or a missing file', () => {
    const extra = copy((d) => writeFileSync(join(d, 'dev/more.jsonl'), '{}\n'), false);
    expect(checkSets(extra.dir, extra.hashes).problems).toContain('dev/more.jsonl is in the set but not in the hashes file.');
    const missing = copy((d) => rmSync(join(d, 'dev/edit.jsonl')), false);
    expect(checkSets(missing.dir, missing.hashes)).toMatchObject({ ok: false, problems: ['dev/edit.jsonl is missing.'] });
  });

  it('fails a tree that is in two splits, even when the hashes were taken again', () => {
    const { dir, hashes } = copy((d) => {
      const train = rows<CreateRow>(d, 'train/create.jsonl');
      const dev = rows<CreateRow>(d, 'dev/create.jsonl');
      const t1 = dev.findIndex((row) => row.tier === 't1');
      const twin = train.find((row) => row.family === dev[t1]!.family)!;
      dev[t1] = { ...dev[t1]!, tree: twin.tree, tree_sha256: twin.tree_sha256 };
      writeFileSync(join(d, 'dev/create.jsonl'), dev.map((row) => `${JSON.stringify(row)}\n`).join(''));
    });
    const result = checkSets(dir, hashes);
    expect(result.ok).toBe(false);
    expect(result.problems.some((p) => /also in train/.test(p))).toBe(true);
  });

  it('fails a training part with a held-out pair', () => {
    const { dir, hashes } = copy((d) => {
      const train = rows<CreateRow>(d, 'train/create.jsonl');
      const dev = rows<CreateRow>(d, 'dev/create.jsonl');
      const paired = dev.find((row) => row.tier === 't2')!;
      train[0] = { ...train[0]!, family: paired.family, tree: paired.tree, tree_sha256: treeHash(paired.tree) };
      writeFileSync(join(d, 'train/create.jsonl'), train.map((row) => `${JSON.stringify(row)}\n`).join(''));
    });
    expect(checkSets(dir, hashes).problems.some((p) => /held-out pair of another split/.test(p))).toBe(true);
  });
});

describe('reading a split', () => {
  it('reads dev, and refuses test unless the final run asks for it', () => {
    expect(readSplit(a, 'dev', 'create')).toHaveLength(11);
    expect(readSplit(a, 'train', 'edit')).toHaveLength(12);
    expect(() => readSplit(a, 'test', 'create')).toThrow(FROZEN);
    expect(() => readSplit(a, 'test', 'edit', { final: false })).toThrow(FROZEN);
    expect(readSplit(a, 'test', 'edit', { final: true })).toHaveLength(3);
  });
});

describe('the sets command', () => {
  it('reads its options', () => {
    expect(parseSetOptions(['make', '--out', 'data/sets/x', '--workers', '3'], REPO)).toEqual({ command: 'make', out: join(REPO, 'data/sets/x'), workers: 3 });
    expect(parseSetOptions(['check'], REPO)).toEqual({ command: 'check', dir: join(REPO, 'data/sets/v1'), hashes: join(REPO, 'datagen/sets-v1.sha256') });
    expect(() => parseSetOptions(['make'], REPO)).toThrow(UsageError);
    expect(() => parseSetOptions(['make', '--out', 'datagen/sets'], REPO)).toThrow(/inside/);
    expect(() => parseSetOptions(['check', '--out', 'x'], REPO)).toThrow(/Unknown option/);
    expect(() => parseSetOptions(['frobnicate'], REPO)).toThrow(/make or check/);
  });

  it('exits 0 for a good set, 1 for a bad one and 2 for wrong options', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      expect(await main(['check', '--dir', a, '--hashes', join(a, 'sets.sha256')])).toBe(0);
      expect(await main(['check', '--dir', join(a, 'nope'), '--hashes', join(a, 'sets.sha256')])).toBe(1);
      expect(await main(['make'])).toBe(2);
      expect(await main(['make', '--out', a])).toBe(2);
    } finally {
      log.mockRestore();
      err.mockRestore();
    }
  });
});
