import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { main, parseOptions, UsageError } from '../src/cli.ts';
import { REPO } from '../src/git.ts';
import { BUILD_MISSING, buildSha256, canonical, type Row, run, treeHash } from '../src/run.ts';

const generator = { name: 'gkod-datagen', version: '0.1.0', commit: 'test', dirty: false };
const dirs: string[] = [];
const fresh = () => {
  const dir = mkdtempSync(join(tmpdir(), 'gkod-datagen-'));
  dirs.push(dir);
  return dir;
};

afterAll(() => dirs.forEach((dir) => rmSync(dir, { recursive: true, force: true })));

describe('run', () => {
  it('gives byte-identical files for the same seed, whatever the number of workers', async () => {
    const [a, b] = [fresh(), fresh()];
    const first = await run({ count: 20, seed: 1, out: a, workers: 4, generator });
    const second = await run({ count: 20, seed: 1, out: b, workers: 2, generator });
    for (const file of ['parts.jsonl', 'skipped.jsonl', 'manifest.json']) {
      expect(readFileSync(join(b, file), 'utf8'), file).toBe(readFileSync(join(a, file), 'utf8'));
    }
    expect(second).toEqual(first);

    const rows = readFileSync(join(a, 'parts.jsonl'), 'utf8').trim().split('\n').map((line) => JSON.parse(line) as Row);
    // skipped trees do not count: the run goes on until it has 20 parts
    expect(rows.length).toBe(20);
    expect(rows.at(-1)!.index).toBe(19 + first.skipped);
    expect(rows.map((row) => row.index)).toEqual([...rows.map((row) => row.index)].sort((x, y) => x - y));
    expect(first.rows).toBe(rows.length);
    expect(first.rates.compile).toBeGreaterThanOrEqual(0.95);
    expect(first.rates.checks).toBeGreaterThanOrEqual(0.9);
    expect(first.rates.params).toBe(first.rates.compile);
    expect(first.rates.facts).toBe(first.rates.compile);
    for (const row of rows) {
      expect(row.generator).toEqual(generator);
      expect(row.seed).toBe(1);
      expect(row.id).toBe(`s1-${String(row.index).padStart(6, '0')}`);
      expect(row.request.length).toBeGreaterThan(10);
      // a count in digits never sits right before a size
      expect(row.request).not.toMatch(/\b\d+ \d/);
      expect(row.code.startsWith(`// ${row.title}\n`)).toBe(true);
      expect(row.labels.checks?.results.map((check) => check.id)).toEqual(['closed', 'fits-bed', 'flat-base', 'overhang']);
    }
    // every row is a different part, named by its tree's hash
    expect(new Set(rows.map((row) => row.tree_sha256)).size).toBe(rows.length);
    for (const row of rows) expect(row.tree_sha256).toBe(treeHash(row.tree));
    expect(first.trees.unique).toBe(rows.length);
    const timings = readFileSync(join(a, 'timings.jsonl'), 'utf8').trim().split('\n');
    expect(timings).toHaveLength(rows.length);
  }, 120000);

  it('makes the same part at an index however many parts the run has', async () => {
    const [small, big] = [fresh(), fresh()];
    await run({ count: 6, seed: 7, out: small, workers: 3, generator });
    await run({ count: 9, seed: 7, out: big, workers: 3, generator });
    const lines = (dir: string) => readFileSync(join(dir, 'parts.jsonl'), 'utf8').trim().split('\n');
    const shared = lines(small);
    expect(lines(big).slice(0, shared.length)).toEqual(shared);
  }, 120000);
});

describe('tree hash', () => {
  it('does not depend on the order of keys', () => {
    expect(canonical({ b: 1, a: [2, { d: 3, c: 'x' }] })).toBe('{"a":[2,{"c":"x","d":3}],"b":1}');
    const tree = { family: 'test', body: { kind: 'plate', width: 80, depth: 50 }, features: [] };
    const same = { features: [], body: { depth: 50, width: 80, kind: 'plate' }, family: 'test' };
    expect(treeHash(same as never)).toBe(treeHash(tree as never));
    expect(treeHash({ ...tree, family: 'other' } as never)).not.toBe(treeHash(tree as never));
  });
});

describe('a missing OpenSCAD build', () => {
  const nowhere = new URL('file:///gkod-no-such-folder/');

  it('stops before anything is written', async () => {
    expect(() => buildSha256(nowhere)).toThrow(BUILD_MISSING);
    const out = join(REPO, 'data/parts/never-made-by-a-test');
    const said = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      expect(await main(['--count', '3', '--out', out], nowhere)).toBe(2);
      expect(said).toHaveBeenCalledWith(BUILD_MISSING);
    } finally {
      said.mockRestore();
    }
    expect(existsSync(out)).toBe(false);
  });
});

describe('options', () => {
  it('reads the options and keeps the output inside data/', () => {
    const options = parseOptions(['--count', '50', '--seed', '3', '--out', 'data/parts/a', '--workers', '2'], REPO);
    expect(options).toEqual({ count: 50, seed: 3, out: join(REPO, 'data/parts/a'), workers: 2 });
    expect(parseOptions(['--out', 'data/parts/b'], REPO).count).toBe(1000);
  });

  it('refuses a bad count, an unknown option or a folder outside data/', () => {
    expect(() => parseOptions(['--out', 'data/x', '--count', '0'], REPO)).toThrow(UsageError);
    expect(() => parseOptions(['--out', 'data/x', '--seed', '-1'], REPO)).toThrow(UsageError);
    expect(() => parseOptions(['--out', 'data/x', '--fast'], REPO)).toThrow('Unknown option: --fast');
    expect(() => parseOptions(['--count', '5'], REPO)).toThrow('--out is needed.');
    expect(() => parseOptions(['--out', 'parts'], REPO)).toThrow(UsageError);
    expect(() => parseOptions(['--out', 'data'], REPO)).toThrow(UsageError);
    expect(() => parseOptions(['--out', 'data/../app'], REPO)).toThrow(UsageError);
  });
});
