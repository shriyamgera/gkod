import { existsSync } from 'node:fs';
import { availableParallelism } from 'node:os';
import { join, relative, resolve, sep } from 'node:path';
import { BUILD_DIR } from '../../../tools/src/compile.ts';
import { REPO, sourceOf } from '../git.ts';
import { BUILD_MISSING } from '../run.ts';
import { runEdits } from './run.ts';
import { loadAvoid, loadSources, shown, SourceError } from './source.ts';

export const USAGE = `Usage: gkod-datagen edits --from data/parts/<name> --count 300 --seed 1 --out <folder>
       [--workers 8] [--avoid <parts.jsonl or hashes.txt> ...] [--no-manifest]

Makes --count edit pairs from the parts in --from (a run folder or a parts .jsonl file with its manifest.json): for
each pair a part, an edit picked by the seed, the edited part's code, an instruction and the facts. Both codes are
compiled and the edited part is checked. Edited parts whose tree is in an --avoid file are not made.
Writes pairs.jsonl, skipped.jsonl, timings.jsonl and manifest.json into --out, which must be inside data/ or outside
the repo.`;

export class UsageError extends Error {}

export type EditOptions = { from: string; count: number; seed: number; out: string; workers: number; avoid: string[]; noManifest: boolean };

function whole(flag: string, text: string | undefined, lo: number, hi: number): number {
  const value = Number(text);
  if (text === undefined || !/^\d+$/.test(text) || value < lo || value > hi) throw new UsageError(`${flag} takes a whole number from ${lo} to ${hi}.`);
  return value;
}

export function parseEditOptions(argv: string[], cwd = process.cwd()): EditOptions {
  const given = new Map<string, string | undefined>();
  const avoid: string[] = [];
  let noManifest = false;
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i]!;
    if (flag === '--no-manifest') noManifest = true;
    else if (flag === '--avoid') {
      const path = argv[++i];
      if (!path) throw new UsageError('--avoid needs a file.');
      avoid.push(resolve(cwd, path));
    } else if (['--from', '--count', '--seed', '--out', '--workers'].includes(flag)) given.set(flag, argv[++i]);
    else throw new UsageError(`Unknown option: ${flag}`);
  }
  if (!given.get('--from')) throw new UsageError('--from is needed.');
  if (!given.get('--out')) throw new UsageError('--out is needed.');
  const out = resolve(cwd, given.get('--out')!);
  const data = join(REPO, 'data');
  // generated rows stay out of the repo's tracked files: in data/, which git ignores, or outside the repo
  const inRepo = (out + sep).startsWith(REPO);
  if (inRepo && (!(out + sep).startsWith(data + sep) || out === data)) throw new UsageError(`--out must be a folder inside ${data} or outside the repo.`);
  return {
    from: resolve(cwd, given.get('--from')!),
    count: whole('--count', given.get('--count') ?? '300', 1, 1_000_000),
    seed: whole('--seed', given.get('--seed') ?? '1', 0, 0xffffffff),
    out,
    workers: whole('--workers', given.get('--workers') ?? String(Math.min(8, availableParallelism())), 1, 64),
    avoid,
    noManifest,
  };
}

export async function main(argv: string[], build: URL = BUILD_DIR): Promise<number> {
  if (argv.includes('--help') || argv.includes('-h')) {
    console.log(USAGE);
    return 0;
  }
  let options: EditOptions;
  try {
    options = parseEditOptions(argv);
  } catch (error) {
    if (!(error instanceof UsageError)) throw error;
    console.error(`${error.message}\n\n${USAGE}`);
    return 2;
  }
  if (!existsSync(new URL('openscad.wasm', build))) {
    console.error(BUILD_MISSING);
    return 2;
  }
  if (existsSync(join(options.out, 'pairs.jsonl'))) {
    console.error(`${shown(options.out)} already holds a run. Pick a new --out folder.`);
    return 2;
  }
  let sources;
  let avoid;
  try {
    sources = loadSources(options.from, { noManifest: options.noManifest });
    avoid = loadAvoid(options.avoid);
  } catch (error) {
    if (!(error instanceof SourceError)) throw error;
    console.error(error.message);
    return 2;
  }
  const generator = sourceOf();
  if (generator.dirty) console.error('Note: the repo has uncommitted changes, so this run is marked dirty.');
  const started = performance.now();
  const manifest = await runEdits({
    count: options.count,
    seed: options.seed,
    out: options.out,
    workers: options.workers,
    generator,
    sources,
    avoid,
    progress: (done) => {
      if (done % 100 === 0 || done === options.count) process.stderr.write(`\r${done} / ${options.count}`);
    },
  });
  const seconds = ((performance.now() - started) / 1000).toFixed(1);
  const pct = (rate: number) => `${(rate * 100).toFixed(1)}%`;
  console.error('');
  console.log(
    [
      `${manifest.rows} pairs and ${manifest.skipped} skipped in ${seconds} s -> ${relative(process.cwd(), options.out) || '.'}`,
      `code A compiled ${pct(manifest.rates.a_compile)}; code B compiled ${pct(manifest.rates.compile)}, passed the print checks ` +
        `${pct(manifest.rates.checks)}, sizes match ${pct(manifest.rates.params)}, stated sizes match the mesh ${pct(manifest.rates.facts)}, ` +
        `only the edited sizes differ ${pct(manifest.rates.sizes)}`,
      `pairs.jsonl sha256 ${manifest.files['pairs.jsonl']!.sha256}`,
    ].join('\n'),
  );
  return 0;
}
