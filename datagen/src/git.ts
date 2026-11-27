import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export const REPO = fileURLToPath(new URL('../../', import.meta.url));

export type Source = { name: string; version: string; commit: string; dirty: boolean };

/** The generator's name, version and the commit of the code that ran, with dirty set when files were changed. */
export function sourceOf(): Source {
  const { version } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { version: string };
  const git = (...args: string[]) => execFileSync('git', args, { cwd: REPO, encoding: 'utf8' }).trim();
  try {
    return { name: 'gkod-datagen', version, commit: git('rev-parse', 'HEAD'), dirty: git('status', '--porcelain') !== '' };
  } catch {
    return { name: 'gkod-datagen', version, commit: 'unknown', dirty: true };
  }
}
