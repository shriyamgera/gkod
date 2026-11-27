import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { REPO } from '../src/git.ts';
import { type Row, run } from '../src/run.ts';
import { main, parseEditOptions, UsageError } from '../src/edits/cli.ts';
import { type EditRow, runEdits } from '../src/edits/run.ts';
import { loadAvoid, loadSources, SourceError } from '../src/edits/source.ts';

const generator = { name: 'gkod-datagen', version: '0.1.0', commit: 'test', dirty: false };
const dirs: string[] = [];
const fresh = () => {
  const dir = mkdtempSync(join(tmpdir(), 'gkod-edits-'));
  dirs.push(dir);
  return dir;
};
const lines = (file: string) => readFileSync(file, 'utf8').trim().split('\n');

let parts: string;
beforeAll(async () => {
  parts = fresh();
  await run({ count: 24, seed: 2, out: parts, workers: 4, generator });
}, 120000);
afterAll(() => dirs.forEach((dir) => rmSync(dir, { recursive: true, force: true })));

describe('edit run', () => {
  it('gives byte-identical files for the same seed, whatever the number of workers, and every edited part passes', async () => {
    const sources = loadSources(parts);
    const [a, b] = [fresh(), fresh()];
    const first = await runEdits({ count: 16, seed: 5, out: a, workers: 4, generator, sources });
    const second = await runEdits({ count: 16, seed: 5, out: b, workers: 1, generator, sources });
    for (const file of ['pairs.jsonl', 'skipped.jsonl', 'manifest.json']) {
      expect(readFileSync(join(b, file), 'utf8'), file).toBe(readFileSync(join(a, file), 'utf8'));
    }
    expect(second).toEqual(first);
    const rows = lines(join(a, 'pairs.jsonl')).map((line) => JSON.parse(line) as EditRow);
    expect(rows).toHaveLength(16);
    expect(first.rows).toBe(16);
    expect(rows.map((row) => row.index)).toEqual([...rows.map((row) => row.index)].sort((x, y) => x - y));
    expect(first.rates).toEqual({ a_compile: 1, compile: 1, checks: 1, params: 1, facts: 1, sizes: 1 });
    expect(first.source).toMatchObject({ sha256: sources.sha256, rows: 24, commits: ['test'] });
    for (const row of rows) {
      expect(row.id).toBe(`e5-${String(row.index).padStart(6, '0')}`);
      expect(row.generator).toEqual(generator);
      expect(row.source.file_sha256).toBe(sources.sha256);
      expect(row.labels.checks?.results.map((check) => check.id)).toEqual(['closed', 'fits-bed', 'flat-base', 'overhang']);
    }
    expect(Object.values(first.ops).reduce((x, y) => x + y, 0)).toBe(16);
    expect(lines(join(a, 'timings.jsonl'))).toHaveLength(16);
  }, 120000);

  it('makes the same pair at an index however many pairs the run has', async () => {
    const sources = loadSources(parts);
    const [small, big] = [fresh(), fresh()];
    await runEdits({ count: 4, seed: 6, out: small, workers: 2, generator, sources });
    await runEdits({ count: 7, seed: 6, out: big, workers: 3, generator, sources });
    const shared = lines(join(small, 'pairs.jsonl'));
    expect(lines(join(big, 'pairs.jsonl')).slice(0, shared.length)).toEqual(shared);
  }, 120000);

  it('refuses to start when a source part is also in an avoided file', async () => {
    const sources = loadSources(parts);
    const avoid = loadAvoid([join(parts, 'parts.jsonl')]);
    await expect(runEdits({ count: 2, seed: 1, out: fresh(), workers: 1, generator, sources, avoid })).rejects.toThrow(/splits overlap/);
  });
});

describe('source parts', () => {
  const copy = (edit: (rows: Row[]) => void, manifest = true) => {
    const dir = fresh();
    const rows = lines(join(parts, 'parts.jsonl')).map((line) => JSON.parse(line) as Row);
    edit(rows);
    const text = rows.map((row) => `${JSON.stringify(row)}\n`).join('');
    writeFileSync(join(dir, 'parts.jsonl'), text);
    if (manifest) writeFileSync(join(dir, 'manifest.json'), readFileSync(join(parts, 'manifest.json')));
    return dir;
  };

  it('reads a complete run', () => {
    const sources = loadSources(parts);
    expect(sources.rows).toHaveLength(24);
    expect(sources.commits).toEqual(['test']);
    expect(loadSources(join(parts, 'parts.jsonl')).sha256).toBe(sources.sha256);
  });

  it('refuses a file its manifest does not vouch for, unless told there is no manifest', () => {
    expect(() => loadSources(copy(() => {}, false))).toThrow(/--no-manifest/);
    expect(loadSources(copy(() => {}, false), { noManifest: true }).rows).toHaveLength(24);
    expect(() => loadSources(copy((rows) => rows.pop()))).toThrow(SourceError);
  });

  it('refuses rows that are dirty, unchecked, changed or written by another serializer', () => {
    const dirty = copy((rows) => (rows[3]!.generator = { ...rows[3]!.generator, dirty: true }), false);
    expect(() => loadSources(dirty, { noManifest: true })).toThrow(/uncommitted/);
    const unknown = copy((rows) => (rows[0]!.generator = { ...rows[0]!.generator, commit: 'unknown' }), false);
    expect(() => loadSources(unknown, { noManifest: true })).toThrow(/no generator source/);
    const failed = copy((rows) => (rows[1]!.labels.checks!.ok = false), false);
    expect(() => loadSources(failed, { noManifest: true })).toThrow(/did not compile or pass/);
    const moved = copy((rows) => (rows[2]!.tree.family = 'other'), false);
    expect(() => loadSources(moved, { noManifest: true })).toThrow(/tree_sha256/);
    const rewritten = copy((rows) => (rows[4]!.code = rows[4]!.code.replace('$fn = 48', '$fn = 64')), false);
    expect(() => loadSources(rewritten, { noManifest: true })).toThrow(/different code/);
  });

  it('reads tree hashes to avoid from parts files, pair files and plain lists', () => {
    const dir = fresh();
    const hash = 'a'.repeat(64);
    writeFileSync(join(dir, 'hashes.txt'), `${hash}\n\n`);
    writeFileSync(join(dir, 'pairs.jsonl'), `${JSON.stringify({ a: { tree_sha256: 'b'.repeat(64) }, b: { tree_sha256: 'c'.repeat(64) } })}\n`);
    const avoid = loadAvoid([join(dir, 'hashes.txt'), join(dir, 'pairs.jsonl'), join(parts, 'parts.jsonl')]);
    expect(avoid.hashes.size).toBe(3 + 24);
    expect(avoid.files).toHaveLength(3);
    writeFileSync(join(dir, 'bad.txt'), '{"x": 1}\n');
    expect(() => loadAvoid([join(dir, 'bad.txt')])).toThrow(/no tree hash/);
  });
});

describe('edits command', () => {
  it('reads the options and keeps the output in data/ or outside the repo', () => {
    const options = parseEditOptions(['--from', 'data/parts/a', '--count', '50', '--seed', '3', '--out', 'data/edits/a', '--workers', '2', '--avoid', 'x.txt', '--avoid', 'y.jsonl'], REPO);
    expect(options).toEqual({
      from: join(REPO, 'data/parts/a'),
      count: 50,
      seed: 3,
      out: join(REPO, 'data/edits/a'),
      workers: 2,
      avoid: [join(REPO, 'x.txt'), join(REPO, 'y.jsonl')],
      noManifest: false,
    });
    expect(parseEditOptions(['--from', 'p', '--out', join(tmpdir(), 'gkod-edits-out')], REPO).count).toBe(300);
    expect(parseEditOptions(['--from', 'p', '--out', 'data/e', '--no-manifest'], REPO).noManifest).toBe(true);
  });

  it('refuses a bad count, an unknown option or a folder in the repo outside data/', () => {
    expect(() => parseEditOptions(['--from', 'p', '--out', 'data/x', '--count', '0'], REPO)).toThrow(UsageError);
    expect(() => parseEditOptions(['--from', 'p', '--out', 'data/x', '--fast'], REPO)).toThrow('Unknown option: --fast');
    expect(() => parseEditOptions(['--out', 'data/x'], REPO)).toThrow('--from is needed.');
    expect(() => parseEditOptions(['--from', 'p'], REPO)).toThrow('--out is needed.');
    expect(() => parseEditOptions(['--from', 'p', '--out', 'datagen/x'], REPO)).toThrow(UsageError);
    expect(() => parseEditOptions(['--from', 'p', '--out', 'data'], REPO)).toThrow(UsageError);
    expect(() => parseEditOptions(['--from', 'p', '--out', '.'], REPO)).toThrow(UsageError);
    expect(() => parseEditOptions(['--from', 'p', '--out', 'data/x', '--avoid'], REPO)).toThrow('--avoid needs a file.');
  });

  it('stops before anything is written when the OpenSCAD build or the source is missing', async () => {
    const said = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const out = join(fresh(), 'never');
      expect(await main(['--from', parts, '--out', out], new URL('file:///gkod-no-such-folder/'))).toBe(2);
      expect(await main(['--from', join(parts, 'nothing-here'), '--out', out])).toBe(2);
      expect(said).toHaveBeenCalledWith(expect.stringMatching(/no parts file/));
      expect(existsSync(out)).toBe(false);
    } finally {
      said.mockRestore();
    }
  });
});
