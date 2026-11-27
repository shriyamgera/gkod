import { existsSync } from 'node:fs';
import { availableParallelism } from 'node:os';
import { join, relative, resolve, sep } from 'node:path';
import { REPO, sourceOf } from './git.ts';
import { BUILD_DIR } from '../../tools/src/compile.ts';
import { BUILD_MISSING, run } from './run.ts';

export const USAGE = `Usage: gkod-datagen --count 1000 --seed 1 --out data/parts/<name> [--workers 8]

Makes --count program-built training parts: a feature tree, a request and OpenSCAD code for each, compiled and
checked. A tree that breaks a rule is skipped and logged, and the next index is tried.
Writes parts.jsonl, skipped.jsonl, timings.jsonl and manifest.json into the output folder, which must be inside data/.`;

export class UsageError extends Error {}

export type Options = { count: number; seed: number; out: string; workers: number };

function whole(flag: string, text: string | undefined, lo: number, hi: number): number {
  const value = Number(text);
  if (text === undefined || !/^\d+$/.test(text) || value < lo || value > hi) throw new UsageError(`${flag} takes a whole number from ${lo} to ${hi}.`);
  return value;
}

export function parseOptions(argv: string[], cwd = process.cwd()): Options {
  const given = new Map<string, string | undefined>();
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i]!;
    if (!['--count', '--seed', '--out', '--workers'].includes(flag)) throw new UsageError(`Unknown option: ${flag}`);
    given.set(flag, argv[++i]);
  }
  if (!given.has('--out') || !given.get('--out')) throw new UsageError('--out is needed.');
  const data = join(REPO, 'data');
  const out = resolve(cwd, given.get('--out')!);
  if (!(out + sep).startsWith(data + sep) || out === data) throw new UsageError(`--out must be a folder inside ${data}.`);
  return {
    count: whole('--count', given.get('--count') ?? '1000', 1, 1_000_000),
    seed: whole('--seed', given.get('--seed') ?? '1', 0, 0xffffffff),
    out,
    workers: whole('--workers', given.get('--workers') ?? String(Math.min(8, availableParallelism())), 1, 64),
  };
}

export async function main(argv: string[], build: URL = BUILD_DIR): Promise<number> {
  if (argv.includes('--help') || argv.includes('-h')) {
    console.log(USAGE);
    return 0;
  }
  let options: Options;
  try {
    options = parseOptions(argv);
  } catch (error) {
    if (!(error instanceof UsageError)) throw error;
    console.error(`${error.message}\n\n${USAGE}`);
    return 2;
  }
  if (!existsSync(new URL('openscad.wasm', build))) {
    console.error(BUILD_MISSING);
    return 2;
  }
  if (existsSync(join(options.out, 'parts.jsonl'))) {
    console.error(`${relative(REPO, options.out)} already holds a run. Pick a new --out folder.`);
    return 2;
  }
  const generator = sourceOf();
  if (generator.dirty) console.error('Note: the repo has uncommitted changes, so this run is marked dirty.');
  const started = performance.now();
  const manifest = await run({
    ...options,
    generator,
    progress: (done) => {
      if (done % 100 === 0 || done === options.count) process.stderr.write(`\r${done} / ${options.count}`);
    },
  });
  const seconds = ((performance.now() - started) / 1000).toFixed(1);
  const pct = (rate: number) => `${(rate * 100).toFixed(1)}%`;
  console.error('');
  console.log(
    [
      `${manifest.rows} parts and ${manifest.skipped} skipped in ${seconds} s -> ${relative(REPO, options.out)}`,
      `compiled ${pct(manifest.rates.compile)}, passed the print checks ${pct(manifest.rates.checks)}, ` +
        `sizes match ${pct(manifest.rates.params)}, stated sizes match the mesh ${pct(manifest.rates.facts)}`,
      `parts.jsonl sha256 ${manifest.files['parts.jsonl']!.sha256}`,
    ].join('\n'),
  );
  return 0;
}
