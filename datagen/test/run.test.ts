import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { parseOptions, UsageError } from '../src/cli.ts';
import { REPO } from '../src/git.ts';
import { type Row, run } from '../src/run.ts';

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
    expect(rows.length + first.skipped).toBe(20);
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
      expect(row.code.startsWith(`// ${row.title}\n`)).toBe(true);
      expect(row.labels.checks?.results.map((check) => check.id)).toEqual(['closed', 'fits-bed', 'flat-base', 'overhang']);
    }
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
