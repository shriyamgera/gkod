import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SYSTEM_INSTRUCTION } from '../../app/src/engine/prompts.ts';
import { treeHash } from '../src/run.ts';
import { FAMILY_SPLIT, forbiddenPairs, HELD_OUT, pairsIn, SPLITS } from '../src/splits/design.ts';
import { type CreateRow, makeSets, type SetEditRow, type SetManifest } from '../src/splits/make.ts';
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
