// Picks the parts and edit pairs of each piece, in index order and without the compiler, so the same design, seeds
// and generator commit always pick the same rows.
import { sampleTree } from '../families/index.ts';
import type { Source } from '../git.ts';
import { type PlannedPair, planPair } from '../edits/pair.ts';
import { SAME_EDIT } from '../edits/run.ts';
import { Rng } from '../rng.ts';
import { plan, type Row } from '../run.ts';
import { forbiddenPairs, type Pair, pairsIn, type Split } from './design.ts';
import { judge, type Ledger, type Piece, REASONS } from './rules.ts';

export type PlannedPart = ReturnType<typeof plan>;

export type PiecePlan = {
  piece: Piece;
  parts: { part: PlannedPart; pair: Pair | null }[];
  /** indices looked at, from 0 */
  tried: number;
  skipped: Record<string, number>;
};

const sorted = (counts: Record<string, number>) => Object.fromEntries(Object.keys(counts).sort().map((key) => [key, counts[key]!]));

/** The most indices a piece may look at before it gives up: a quota that cannot fill is a mistake in the design. */
export const limitFor = (count: number) => 2000 * count + 200_000;

/** Picks a create piece's parts and adds their trees to the ledger. */
export function planPiece(piece: Piece, ledger: Ledger, generator: Source): PiecePlan {
  const parts: PiecePlan['parts'] = [];
  const taken = new Map<string, number>();
  const skipped: Record<string, number> = {};
  const skip = (reason: string) => (skipped[reason] = (skipped[reason] ?? 0) + 1);
  const limit = limitFor(piece.count);
  let index = 0;
  for (; parts.length < piece.count; index++) {
    if (index >= limit) throw new Error(`${piece.split} ${piece.tier} found only ${parts.length} of ${piece.count} parts in ${limit} indices.`);
    // the same tree plan() makes, looked at first so other families cost no request or code
    const tree = sampleTree(new Rng(piece.seed).child(index));
    if (!piece.families.includes(tree.family)) {
      skip(REASONS.family);
      continue;
    }
    const part = plan(piece.seed, index, generator);
    if (!part.row) {
      skip(part.skip!.reasons[0]!);
      continue;
    }
    const verdict = judge(piece, part.row.tree, part.row.tree_sha256, ledger, taken);
    if ('reason' in verdict) {
      skip(verdict.reason);
      continue;
    }
    if (verdict.key !== null) taken.set(verdict.key, (taken.get(verdict.key) ?? 0) + 1);
    ledger.add(piece.split, part.row.tree, part.row.tree_sha256);
    parts.push({ part, pair: verdict.pair });
  }
  return { piece, parts, tried: index, skipped: sorted(skipped) };
}

export type EditPlan = { split: Split; seed: number; count: number; pairs: PlannedPair[]; tried: number; skipped: Record<string, number> };

/**
 * Picks a split's edit pairs from its own parts. An edited part may not be a tree (or a near-copy of a tree) of
 * another split, or have a feature pair held out for another split (any held-out pair, for training).
 */
export function planEdits(opts: { split: Split; seed: number; count: number; sources: readonly Row[]; fileSha256: string; ledger: Ledger; generator: Source }): EditPlan {
  const { split, ledger } = opts;
  const avoid = ledger.others(split);
  const clash = opts.sources.find((row) => avoid.has(row.tree_sha256));
  if (clash) throw new Error(`Source part ${clash.id} is in another split too.`);
  const pairOptions = { seed: opts.seed, generator: opts.generator, sources: opts.sources, fileSha256: opts.fileSha256, avoid };
  const pairs: PlannedPair[] = [];
  const seen = new Set<string>();
  const skipped: Record<string, number> = {};
  const skip = (reason: string) => (skipped[reason] = (skipped[reason] ?? 0) + 1);
  const limit = limitFor(opts.count);
  let index = 0;
  for (; pairs.length < opts.count; index++) {
    if (index >= limit) throw new Error(`${split} edits found only ${pairs.length} of ${opts.count} pairs in ${limit} indices.`);
    const planned = planPair(pairOptions, index);
    const pair = planned.pair;
    if (!pair) {
      skip(planned.skip!.reasons[0]!);
      continue;
    }
    const key = `${pair.a.tree_sha256}>${pair.b.tree_sha256}`;
    if (seen.has(key)) {
      skip(SAME_EDIT);
      continue;
    }
    if (pairsIn(pair.b.tree, forbiddenPairs(split)).length) {
      skip(REASONS.heldOut);
      continue;
    }
    const reason = ledger.clash(split, pair.b.tree, pair.b.tree_sha256);
    if (reason) {
      skip(reason);
      continue;
    }
    seen.add(key);
    ledger.add(split, pair.b.tree, pair.b.tree_sha256);
    pairs.push(planned);
  }
  return { split, seed: opts.seed, count: opts.count, pairs, tried: index, skipped: sorted(skipped) };
}
