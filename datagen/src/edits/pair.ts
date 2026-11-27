// One edit pair: a source part (tree A, code A), an edit picked by the pair's own seed, the edited part (tree B, code B),
// the instruction and the facts. Everything here is worked out without the compiler, so the same seed and source file
// always give the same pair.
import type { Source } from '../git.ts';
import type { Fact } from '../phrases.ts';
import { Rng } from '../rng.ts';
import { type Row, treeHash } from '../run.ts';
import type { Param } from '../scad.ts';
import type { Tree } from '../tree.ts';
import { styleOf } from '../words.ts';
import { buildB, diffSizes, type SizeDiff, sideOf } from './build.ts';
import { applyOp, candidates, type EditOp, kindOrder } from './ops.ts';
import { axisFacts, type EditFact, instruct } from './say.ts';

export type EditFacts = SizeDiff & {
  /** what the instruction states, checkable on the edited part */
  stated: EditFact[];
};

export type Pair = {
  id: string;
  index: number;
  generator: Source;
  seed: number;
  pair_seed: number;
  /** where tree A came from: the part's id and generator, and the sha256 of the parts file it was read from */
  source: { id: string; seed: number; part_seed: number; generator: Source; file_sha256: string };
  family: string;
  op: EditOp;
  instruction: string;
  a: { tree: Tree; tree_sha256: string; title: string; request: string; code: string };
  b: { tree: Tree; tree_sha256: string; title: string; code: string };
  facts: EditFacts;
};

export type PlannedPair = {
  index: number;
  pair?: Pair;
  /** code B's size block, for the compile check */
  params?: Param[];
  /** the facts to check on B's mesh: what is stated with an axis, and B's overall sizes */
  meshFacts?: Fact[];
  skip?: { source: string; family: string; reasons: string[] };
};

export type PairOptions = { seed: number; generator: Source; sources: readonly Row[]; fileSha256: string; avoid?: ReadonlySet<string> };

/** Which sizes each kind of edit may change, add or remove; a pair that breaks this is a bug in the edits. */
function fits(op: EditOp, diff: SizeDiff): boolean {
  const names = (list: { name: string }[]) => list.map((x) => x.name).join(',');
  switch (op.kind) {
    case 'scale':
      return !diff.added.length && !diff.removed.length && diff.kept.every((k) => k.name.endsWith('_count'));
    case 'add':
      return !diff.changed.length && !diff.removed.length && diff.added.length > 0;
    case 'remove':
      return !diff.changed.length && !diff.added.length && diff.removed.length > 0;
  }
  if (op.name === null) {
    if (op.feature === 'gussets') return !diff.changed.length && !diff.added.length && !diff.removed.length;
    const spacing = diff[op.to === 2 ? 'added' : 'removed'];
    return !diff.changed.length && !diff[op.to === 2 ? 'removed' : 'added'].length && spacing.length === 1 && spacing[0]!.name.endsWith('hole_spacing');
  }
  return names(diff.changed) === op.name && !diff.added.length && !diff.removed.length;
}

/** Pair number `index`: its source part and edit come from the run seed and the index alone. */
export function planPair(opts: PairOptions, index: number): PlannedPair {
  const rng = new Rng(opts.seed).child(index);
  const row = opts.sources[rng.child(0).int(0, opts.sources.length - 1)]!;
  const skip = (reasons: string[]): PlannedPair => ({ index, skip: { source: row.id, family: row.family, reasons } });
  const a = sideOf(row.tree);
  if ('reason' in a) return skip([a.reason]);
  const pick = rng.child(1);
  const tried: string[] = [];
  for (const kind of kindOrder(pick)) {
    for (const op of candidates(kind, a, pick)) {
      const tree = applyOp(row.tree, a.model, op);
      const hash = treeHash(tree);
      if (hash === row.tree_sha256) continue;
      if (opts.avoid?.has(hash)) {
        tried.push('The edited part is in another split.');
        continue;
      }
      const b = buildB(row, a.params, tree);
      if ('reason' in b) {
        tried.push(b.reason);
        continue;
      }
      const diff = diffSizes(a.params, b.params);
      if (!fits(op, diff)) throw new Error(`Edit ${JSON.stringify(op)} on ${row.id} changed other sizes too.`);
      // the words have their own generator, so a change to the wording never changes which edit is made
      const words = rng.child(2);
      const said = instruct(op, { a, b, s: styleOf(words), rng: words });
      const meshFacts = [...said.facts, ...axisFacts(b)].filter((f) => f.axis).map(({ key, value, axis }): Fact => ({ key, value, unit: 'mm', axis }));
      return {
        index,
        params: b.params,
        meshFacts,
        pair: {
          id: `e${opts.seed}-${String(index).padStart(6, '0')}`,
          index,
          generator: opts.generator,
          seed: opts.seed,
          pair_seed: rng.seed,
          source: { id: row.id, seed: row.seed, part_seed: row.part_seed, generator: row.generator, file_sha256: opts.fileSha256 },
          family: row.family,
          op,
          instruction: said.text,
          a: { tree: row.tree, tree_sha256: row.tree_sha256, title: row.title, request: row.request, code: row.code },
          b: { tree, tree_sha256: hash, title: b.title, code: b.code },
          facts: { stated: said.facts, ...diff },
        },
      };
    }
  }
  return skip(tried.length ? [...new Set(tried)] : ['The part allows no edit.']);
}
