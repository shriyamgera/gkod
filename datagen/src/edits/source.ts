// Reads the parts an edit run starts from, and the tree hashes it must not make. A parts file is used only when it is
// complete (its manifest lists its sha256 and row count), every row comes from the generator with a clean commit,
// passed its labels, and still gets the same code from this serializer, so code B differs from code A only by the edit.
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { basename, dirname, join, relative, sep } from 'node:path';
import { REPO } from '../git.ts';
import { type Row, treeHash } from '../run.ts';
import { serialize } from '../serialize.ts';

export class SourceError extends Error {}

export type Sources = {
  rows: Row[];
  /** the file, relative to the repo when it is inside it */
  path: string;
  sha256: string;
  /** every generator commit the rows were made by */
  commits: string[];
};

const sha256 = (data: string | Uint8Array) => createHash('sha256').update(data).digest('hex');

/** A path as the manifest records it: relative to the repo inside it, so two runs in different folders match. */
export function shown(path: string): string {
  return (path + sep).startsWith(REPO) ? relative(REPO, path) : path;
}

/** The parts file of a run folder, or the file itself. */
export function partsFile(from: string): string {
  return from.endsWith('.jsonl') ? from : join(from, 'parts.jsonl');
}

export function loadSources(from: string, opts: { noManifest?: boolean } = {}): Sources {
  const file = partsFile(from);
  if (!existsSync(file)) throw new SourceError(`There is no parts file at ${shown(file)}.`);
  const bytes = readFileSync(file);
  const hash = sha256(bytes);
  const lines = bytes.toString('utf8').split('\n').filter((line) => line.trim());
  const manifestPath = join(dirname(file), 'manifest.json');
  if (existsSync(manifestPath)) {
    const listed = (JSON.parse(readFileSync(manifestPath, 'utf8')) as { files?: Record<string, { rows: number; sha256: string }> }).files?.[basename(file)];
    if (!listed) throw new SourceError(`manifest.json does not list ${basename(file)}.`);
    if (listed.sha256 !== hash) throw new SourceError(`${basename(file)} does not match the sha256 in its manifest, so it was changed or is not complete.`);
    if (listed.rows !== lines.length) throw new SourceError(`${basename(file)} has ${lines.length} rows, but its manifest lists ${listed.rows}.`);
  } else if (!opts.noManifest) {
    throw new SourceError(`There is no manifest.json beside ${basename(file)}, so it may not be complete. Use it anyway with --no-manifest.`);
  }
  const rows: Row[] = [];
  const commits = new Set<string>();
  for (const [i, line] of lines.entries()) {
    const row = JSON.parse(line) as Row;
    const where = `Row ${i + 1} (${row.id ?? 'no id'})`;
    if (row.generator?.name !== 'gkod-datagen' || !row.generator.commit || row.generator.commit === 'unknown') throw new SourceError(`${where} has no generator source.`);
    if (row.generator.dirty) throw new SourceError(`${where} was made from a repo with uncommitted changes, so it cannot be rebuilt.`);
    if (!row.labels?.compile.ok || !row.labels.checks?.ok || !row.labels.params_ok) throw new SourceError(`${where} did not compile or pass its checks.`);
    if (treeHash(row.tree) !== row.tree_sha256) throw new SourceError(`${where} has a tree that does not match its tree_sha256.`);
    const written = serialize(row.tree, row.title);
    if ('reason' in written || written.code !== row.code) {
      throw new SourceError(`${where} gets different code from this serializer than it holds (made at ${row.generator.commit.slice(0, 7)}). Make the parts again at this commit.`);
    }
    rows.push(row);
    commits.add(row.generator.commit);
  }
  if (!rows.length) throw new SourceError(`${shown(file)} has no rows.`);
  return { rows, path: shown(file), sha256: hash, commits: [...commits].sort() };
}

export type Avoid = { hashes: Set<string>; files: { path: string; sha256: string }[] };

const HASH = /^[0-9a-f]{64}$/;

/**
 * Tree hashes the edited parts must not have, so a part in one split never turns up in another: from parts files
 * (each row's tree_sha256), edit pair files (both sides) or text files with one hash per line.
 */
export function loadAvoid(paths: string[]): Avoid {
  const hashes = new Set<string>();
  const files: Avoid['files'] = [];
  for (const path of paths) {
    if (!existsSync(path)) throw new SourceError(`There is no file at ${shown(path)}.`);
    const text = readFileSync(path, 'utf8');
    files.push({ path: shown(path), sha256: sha256(text) });
    for (const line of text.split('\n').map((l) => l.trim()).filter(Boolean)) {
      if (HASH.test(line)) {
        hashes.add(line);
        continue;
      }
      const row = JSON.parse(line) as { tree_sha256?: string; a?: { tree_sha256?: string }; b?: { tree_sha256?: string } };
      const found = [row.tree_sha256, row.a?.tree_sha256, row.b?.tree_sha256].filter((h): h is string => typeof h === 'string' && HASH.test(h));
      if (!found.length) throw new SourceError(`${shown(path)} has a line with no tree hash.`);
      found.forEach((h) => hashes.add(h));
    }
  }
  return { hashes, files };
}
