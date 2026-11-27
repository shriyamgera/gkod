// Checks a frozen set against the hashes committed in the repo, and checks that it still follows its design: no tree in
// two splits, no near-copy across splits, families and held-out pairs where they belong, provenance and labels on
// every row. The test rows are read only to hash and count them; nothing about them is printed but their ids.
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { treeHash } from '../run.ts';
import type { Tree } from '../tree.ts';
import { FAMILY_SPLIT, forbiddenPairs, HELD_OUT, pairKey, pairsIn, type Split, SPLITS } from './design.ts';
import type { CreateRow, SetEditRow, SetManifest } from './make.ts';
import { NearIndex } from './rules.ts';

const sha256 = (data: string | Uint8Array) => createHash('sha256').update(data).digest('hex');

/** The lines of a sha256 file (`<sha256>  <path>`), as a map from path to hash. */
export function parseHashes(text: string): Map<string, string> {
  const hashes = new Map<string, string>();
  for (const [i, line] of text.split('\n').entries()) {
    if (!line.trim()) continue;
    const match = /^([0-9a-f]{64}) {2}(\S.*)$/.exec(line);
    if (!match) throw new Error(`Line ${i + 1} of the hashes file is not "<sha256>  <path>".`);
    hashes.set(match[2]!, match[1]!);
  }
  return hashes;
}

function filesIn(dir: string): string[] {
  const out: string[] = [];
  const walk = (at: string) => {
    for (const name of readdirSync(at).sort()) {
      const path = join(at, name);
      if (statSync(path).isDirectory()) walk(path);
      else out.push(relative(dir, path));
    }
  };
  walk(dir);
  return out;
}

export type CheckResult = { ok: boolean; done: string[]; problems: string[] };

const TIERS_OF: Record<Split, readonly string[]> = { train: ['train'], dev: ['t1', 't2', 't3'], test: ['t1', 't2', 't3'] };

/** Verifies the set in `dir` against `hashesFile`, then every rule of its design. */
export function checkSets(dir: string, hashesFile: string): CheckResult {
  const done: string[] = [];
  const problems: string[] = [];
  if (!existsSync(dir)) return { ok: false, done, problems: [`There is no set at ${dir}.`] };
  if (!existsSync(hashesFile)) return { ok: false, done, problems: [`There is no hashes file at ${hashesFile}.`] };

  const hashes = parseHashes(readFileSync(hashesFile, 'utf8'));
  let matched = 0;
  for (const [path, hash] of hashes) {
    const file = join(dir, path);
    if (!existsSync(file)) problems.push(`${path} is missing.`);
    else if (sha256(readFileSync(file)) !== hash) problems.push(`${path} does not match its committed sha256.`);
    else matched++;
  }
  for (const path of filesIn(dir)) if (!hashes.has(path) && path !== 'sets.sha256') problems.push(`${path} is in the set but not in the hashes file.`);
  if (matched === hashes.size) done.push(`All ${hashes.size} files match the committed sha256.`);
  if ([...hashes.keys()].some((path) => !existsSync(join(dir, path))) || !hashes.has('manifest.json')) return { ok: false, done, problems };

  const manifest = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8')) as SetManifest;
  const read = <T>(path: string): T[] => {
    const text = readFileSync(join(dir, path), 'utf8');
    const rows = text.split('\n').filter((line) => line.trim()).map((line) => JSON.parse(line) as T);
    if (manifest.files[path]?.rows !== rows.length) problems.push(`${path} has ${rows.length} rows, but the manifest lists ${manifest.files[path]?.rows}.`);
    return rows;
  };

  if (JSON.stringify(manifest.design.families) !== JSON.stringify(FAMILY_SPLIT)) problems.push('The family split in the code is not the one the set was made with.');
  if (JSON.stringify(manifest.design.held_out_pairs) !== JSON.stringify(HELD_OUT)) problems.push('The held-out pairs in the code are not the ones the set was made with.');
  if (manifest.generator.dirty || manifest.generator.commit === 'unknown') problems.push('The set was made from a repo with uncommitted changes.');

  const trees = new Map<string, Split>();
  const near: Record<Split, NearIndex> = { train: new NearIndex(), dev: new NearIndex(), test: new NearIndex() };
  const own: Record<Split, Tree[]> = { train: [], dev: [], test: [] };
  const ids = new Set<string>();
  let total = 0;
  let inTwo = 0;
  const addTree = (split: Split, id: string, tree: Tree, hash: string) => {
    if (treeHash(tree) !== hash) problems.push(`${id} has a tree that does not match its hash.`);
    const held = trees.get(hash);
    if (held && held !== split) {
      inTwo++;
      problems.push(`${id} has a tree that is also in ${held}.`);
    }
    if (!held) {
      trees.set(hash, split);
      near[split].add(tree);
      own[split].push(tree);
    }
  };
  const provenance = (id: string, row: { generator?: { name?: string; commit?: string; dirty?: boolean } }) => {
    if (ids.has(id)) problems.push(`${id} appears twice.`);
    ids.add(id);
    total++;
    const g = row.generator;
    if (g?.name !== 'gkod-datagen' || g.commit !== manifest.generator.commit || g.dirty !== false) problems.push(`${id} does not carry the set's generator commit.`);
  };

  for (const split of SPLITS) {
    const forbidden = forbiddenPairs(split);
    const creates = read<CreateRow>(`${split}/create.jsonl`);
    const families = new Map<string, string>();
    for (const row of creates) {
      provenance(row.id, row);
      families.set(row.id, row.family);
      if (row.split !== split || !TIERS_OF[split].includes(row.tier)) problems.push(`${row.id} is not marked as a ${split} part.`);
      const allowed = row.tier === 't3' ? FAMILY_SPLIT[split] : FAMILY_SPLIT.train;
      if (!allowed.includes(row.family)) problems.push(`${row.id} is from a family that ${split} ${row.tier} may not have.`);
      if (pairsIn(row.tree, forbidden).length) problems.push(`${row.id} has a held-out pair of another split.`);
      if (split !== 'train') {
        const pairs = pairsIn(row.tree, HELD_OUT[split]).map(pairKey);
        const want = row.tier === 't2' && row.held_out_pair ? [pairKey(row.held_out_pair)] : [];
        if (JSON.stringify(pairs) !== JSON.stringify(want)) problems.push(`${row.id} does not have exactly the held-out pairs its tier allows.`);
      }
      const l = row.labels;
      if (!l.compile.ok || !l.checks?.ok || !l.params_ok || !l.facts_ok) problems.push(`${row.id} did not pass every label.`);
      addTree(split, row.id, row.tree, row.tree_sha256);
    }
    for (const row of read<SetEditRow>(`${split}/edit.jsonl`)) {
      provenance(row.id, row);
      if (row.split !== split || row.tier !== 'edit') problems.push(`${row.id} is not marked as a ${split} edit pair.`);
      if (families.get(row.source.id) !== row.family) problems.push(`${row.id} does not come from a ${split} part of its family.`);
      if (pairsIn(row.a.tree, forbidden).length || pairsIn(row.b.tree, forbidden).length) problems.push(`${row.id} has a held-out pair of another split.`);
      const l = row.labels;
      if (!l.compile.ok || !l.checks?.ok || !l.params_ok || !l.facts_ok || !l.a_compile_ok || !l.sizes_ok) problems.push(`${row.id} did not pass every label.`);
      addTree(split, row.id, row.a.tree, row.a.tree_sha256);
      addTree(split, row.id, row.b.tree, row.b.tree_sha256);
    }
  }

  let nearCopies = 0;
  for (const split of SPLITS) {
    for (const tree of own[split]) if (SPLITS.some((other) => other !== split && near[other].has(tree))) nearCopies++;
  }
  if (nearCopies) problems.push(`${nearCopies} trees have a near-copy in another split.`);
  if (manifest.trees.in_two_splits !== 0) problems.push('The manifest lists trees in two splits.');

  const counts = SPLITS.map((split) => `${split} ${manifest.files[`${split}/create.jsonl`]?.rows} parts + ${manifest.files[`${split}/edit.jsonl`]?.rows} edits`);
  done.push(`${total} rows: ${counts.join(', ')}.`);
  if (!inTwo) done.push(`No tree is in two splits (${trees.size} different trees).`);
  if (!nearCopies) done.push('No tree has a near-copy within 0.5 mm in another split.');
  if (!problems.length) done.push('Families, held-out pairs, provenance and labels follow the design on every row.');
  return { ok: problems.length === 0, done, problems };
}
