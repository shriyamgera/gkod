import { existsSync } from 'node:fs';
import { availableParallelism } from 'node:os';
import { join, relative, resolve, sep } from 'node:path';
import { BUILD_DIR } from '../../../tools/src/compile.ts';
import { REPO, sourceOf } from '../git.ts';
import { BUILD_MISSING } from '../run.ts';
import { checkSets } from './check.ts';
import { SET_VERSION } from './design.ts';
import { makeSets } from './make.ts';

export const USAGE = `Usage: gkod-datagen sets make --out data/sets/${SET_VERSION} [--workers 8]
       gkod-datagen sets check [--dir data/sets/${SET_VERSION}] [--hashes datagen/sets-${SET_VERSION}.sha256]

make  writes the frozen train, dev and test sets of the design in datagen/src/splits/design.ts: each split's parts
      (create.jsonl) and edit pairs (edit.jsonl), manifest.json and sets.sha256. Only from a clean commit, into a
      new folder inside data/ or outside the repo.
check verifies every file against the committed hashes, and that no tree is in two splits, no tree has a near-copy
      in another split, and every row follows the design. Prints counts only.`;

export class UsageError extends Error {}

type Parsed = { command: 'make'; out: string; workers: number } | { command: 'check'; dir: string; hashes: string };

function whole(flag: string, text: string | undefined, lo: number, hi: number): number {
  const value = Number(text);
  if (text === undefined || !/^\d+$/.test(text) || value < lo || value > hi) throw new UsageError(`${flag} takes a whole number from ${lo} to ${hi}.`);
  return value;
}

export function parseSetOptions(argv: string[], cwd = process.cwd()): Parsed {
  const [command, ...rest] = argv;
  if (command !== 'make' && command !== 'check') throw new UsageError('Say make or check.');
  const flags = command === 'make' ? ['--out', '--workers'] : ['--dir', '--hashes'];
  const given = new Map<string, string | undefined>();
  for (let i = 0; i < rest.length; i++) {
    const flag = rest[i]!;
    if (!flags.includes(flag)) throw new UsageError(`Unknown option for ${command}: ${flag}`);
    given.set(flag, rest[++i]);
    if (!given.get(flag)) throw new UsageError(`${flag} needs a value.`);
  }
  if (command === 'check') {
    return {
      command,
      dir: resolve(cwd, given.get('--dir') ?? join(REPO, 'data', 'sets', SET_VERSION)),
      hashes: resolve(cwd, given.get('--hashes') ?? join(REPO, 'datagen', `sets-${SET_VERSION}.sha256`)),
    };
  }
  if (!given.get('--out')) throw new UsageError('--out is needed.');
  const out = resolve(cwd, given.get('--out')!);
  const data = join(REPO, 'data');
  // generated rows stay out of the repo's tracked files: in data/, which git ignores, or outside the repo
  if ((out + sep).startsWith(REPO) && (!(out + sep).startsWith(data + sep) || out === data)) throw new UsageError(`--out must be a folder inside ${data} or outside the repo.`);
  return { command, out, workers: whole('--workers', given.get('--workers') ?? String(Math.min(8, availableParallelism())), 1, 64) };
}

const shown = (path: string) => ((path + sep).startsWith(REPO) ? relative(REPO, path) : path);

export async function main(argv: string[], build: URL = BUILD_DIR): Promise<number> {
  if (argv.includes('--help') || argv.includes('-h')) {
    console.log(USAGE);
    return 0;
  }
  let options: Parsed;
  try {
    options = parseSetOptions(argv);
  } catch (error) {
    if (!(error instanceof UsageError)) throw error;
    console.error(`${error.message}\n\n${USAGE}`);
    return 2;
  }

  if (options.command === 'check') {
    const result = checkSets(options.dir, options.hashes);
    for (const line of result.done) console.log(`ok   ${line}`);
    for (const line of result.problems) console.log(`FAIL ${line}`);
    console.log(result.ok ? `The set at ${shown(options.dir)} matches ${shown(options.hashes)} and its design.` : `The set at ${shown(options.dir)} failed the check.`);
    return result.ok ? 0 : 1;
  }

  if (!existsSync(new URL('openscad.wasm', build))) {
    console.error(BUILD_MISSING);
    return 2;
  }
  if (existsSync(join(options.out, 'manifest.json'))) {
    console.error(`${shown(options.out)} already holds a set. Pick a new --out folder.`);
    return 2;
  }
  const generator = sourceOf();
  if (generator.dirty || generator.commit === 'unknown') {
    console.error('The repo has uncommitted changes. A frozen set is made only from a clean commit, so it can be made again.');
    return 2;
  }
  const started = performance.now();
  const manifest = await makeSets({ out: options.out, workers: options.workers, generator, progress: (line) => console.error(line) });
  const seconds = ((performance.now() - started) / 1000).toFixed(1);
  const c = manifest.counts;
  const t = manifest.tokens;
  console.log(
    [
      `Set ${manifest.set} made in ${seconds} s at ${generator.commit.slice(0, 7)} -> ${shown(options.out)}`,
      `train ${c.train.create} parts + ${c.train.edit} edits; dev ${c.dev.t1} + ${c.dev.t2} + ${c.dev.t3} parts + ${c.dev.edit} edits; ` +
        `test ${c.test.t1} + ${c.test.t2} + ${c.test.t3} parts + ${c.test.edit} edits`,
      `trees: train ${manifest.trees.train.unique}, dev ${manifest.trees.dev.unique}, test ${manifest.trees.test.unique}; in two splits ${manifest.trees.in_two_splits}`,
      `train tokens, about (characters / ${t.chars_per_token}): create ${t.create.tokens}, edit ${t.edit.tokens}, total ${t.total}`,
      ...Object.entries(manifest.files).map(([path, file]) => `${file.sha256}  ${path}`),
    ].join('\n'),
  );
  return 0;
}
