// The rules that put a part or an edit pair into a split: its family, the held-out feature pairs, the quotas, and no
// tree (or near-copy of a tree) in two splits.
import type { Tree } from '../tree.ts';
import { FAMILY_SPLIT, forbiddenPairs, HELD_OUT, NEAR_MM, type Pair, pairKey, pairsIn, type Split, SPLITS, type Tier } from './design.ts';

/**
 * A tree with every number taken out, and the numbers in order: two trees with the same shape have the same key. The
 * family's name is left out, so a part of one family that is drawn the same as a part of another (a washer and a plain
 * spacer on the same round body) has the same key; the tree's hash still holds the family.
 */
export function shapeOf(tree: Tree): { key: string; values: number[] } {
  const values: number[] = [];
  const strip = (value: unknown): unknown => {
    if (typeof value === 'number') {
      values.push(value);
      return '#';
    }
    if (Array.isArray(value)) return value.map(strip);
    if (value && typeof value === 'object') {
      const record = value as Record<string, unknown>;
      return Object.keys(record).sort().map((key) => [key, strip(record[key])]);
    }
    return value;
  };
  const { family: _family, ...geometry } = tree;
  const key = JSON.stringify(strip(geometry));
  return { key, values };
}

/** Near-copies: the same shape (body, features, faces, patterns, flags), whatever the family, with every number within NEAR_MM. */
export class NearIndex {
  private buckets = new Map<string, number[][]>();
  size = 0;

  add(tree: Tree): void {
    const { key, values } = shapeOf(tree);
    const bucket = this.buckets.get(key);
    if (bucket) bucket.push(values);
    else this.buckets.set(key, [values]);
    this.size++;
  }

  has(tree: Tree): boolean {
    const { key, values } = shapeOf(tree);
    return (this.buckets.get(key) ?? []).some((other) => other.every((x, i) => Math.abs(x - values[i]!) <= NEAR_MM + 1e-9));
  }
}

export const REASONS = {
  family: 'The family belongs to another split or tier.',
  heldOut: 'It has a feature pair held out for another split.',
  ownPair: 'It has a held-out pair, which only tier 2 may have.',
  noPair: 'It has none of the split\'s held-out pairs.',
  twoPairs: 'It has more than one held-out pair.',
  quota: 'Its family or pair already has its share of the tier.',
  otherSplit: 'The same tree is in another split.',
  nearOther: 'A tree within 0.5 mm of it is in another split.',
  repeat: 'The same part was already made earlier in this split.',
} as const;

/** Every tree each split holds so far (parts and both sides of edit pairs), by hash and for near-copies. */
export class Ledger {
  readonly hashes = new Map<string, Split>();
  readonly near: Record<Split, NearIndex> = { train: new NearIndex(), dev: new NearIndex(), test: new NearIndex() };

  add(split: Split, tree: Tree, hash: string): void {
    const held = this.hashes.get(hash);
    if (held && held !== split) throw new Error(`Tree ${hash.slice(0, 12)} is already in ${held}.`);
    if (held) return;
    this.hashes.set(hash, split);
    this.near[split].add(tree);
  }

  /** Why the tree cannot go into `split`, or null. */
  clash(split: Split, tree: Tree, hash: string): string | null {
    const held = this.hashes.get(hash);
    if (held && held !== split) return REASONS.otherSplit;
    if (SPLITS.some((other) => other !== split && this.near[other].has(tree))) return REASONS.nearOther;
    return null;
  }

  /** The hashes held by every split but this one. */
  others(split: Split): Set<string> {
    return new Set([...this.hashes].filter(([, held]) => held !== split).map(([hash]) => hash));
  }
}

/** `total` shared out over the keys as evenly as it goes, the first keys taking one more. */
export function shares(keys: readonly string[], total: number): Map<string, number> {
  const base = Math.floor(total / keys.length);
  return new Map(keys.map((key, i) => [key, base + (i < total % keys.length ? 1 : 0)]));
}

/** One piece of a set: the rows of one tier of one split, made from one seed. */
export type Piece = {
  split: Split;
  tier: Exclude<Tier, 'edit'>;
  seed: number;
  count: number;
  families: readonly string[];
  /** rows each family (t1, t3) or held-out pair (t2) may have; none for training */
  quota?: Map<string, number>;
};

/** The create pieces in the order they are made: train first, then dev, then test, each tier in turn. */
export function createPieces(counts: { train: number; t1: number; t2: number; t3: number }, seeds: {
  train: number;
  dev: { t1: number; t2: number; t3: number };
  test: { t1: number; t2: number; t3: number };
}): Piece[] {
  const pieces: Piece[] = [{ split: 'train', tier: 'train', seed: seeds.train, count: counts.train, families: FAMILY_SPLIT.train }];
  for (const split of ['dev', 'test'] as const) {
    const s = seeds[split];
    pieces.push(
      { split, tier: 't1', seed: s.t1, count: counts.t1, families: FAMILY_SPLIT.train, quota: shares(FAMILY_SPLIT.train, counts.t1) },
      { split, tier: 't2', seed: s.t2, count: counts.t2, families: FAMILY_SPLIT.train, quota: shares(HELD_OUT[split].map(pairKey), counts.t2) },
      { split, tier: 't3', seed: s.t3, count: counts.t3, families: FAMILY_SPLIT[split], quota: shares(FAMILY_SPLIT[split], counts.t3) },
    );
  }
  return pieces;
}

/** Whether a tree goes into this piece now: null and the quota key it fills, or the reason it does not. */
export function judge(piece: Piece, tree: Tree, hash: string, ledger: Ledger, taken: Map<string, number>): { reason: string } | { key: string | null; pair: Pair | null } {
  if (!piece.families.includes(tree.family)) return { reason: REASONS.family };
  if (pairsIn(tree, forbiddenPairs(piece.split)).length) return { reason: REASONS.heldOut };
  let key: string | null = null;
  let pair: Pair | null = null;
  if (piece.tier === 't1' || piece.tier === 't3') key = tree.family;
  // forbiddenPairs already keeps every pair out of training; tier 1 keeps its own split's pairs out too
  if (piece.tier === 't1' && piece.split !== 'train' && pairsIn(tree, HELD_OUT[piece.split]).length) return { reason: REASONS.ownPair };
  if (piece.tier === 't2' && piece.split !== 'train') {
    const own = pairsIn(tree, HELD_OUT[piece.split]);
    if (!own.length) return { reason: REASONS.noPair };
    if (own.length > 1) return { reason: REASONS.twoPairs };
    pair = own[0]!;
    key = pairKey(pair);
  }
  if (key !== null && piece.quota && (taken.get(key) ?? 0) >= (piece.quota.get(key) ?? 0)) return { reason: REASONS.quota };
  const clash = ledger.clash(piece.split, tree, hash);
  if (clash) return { reason: clash };
  if (ledger.hashes.get(hash) === piece.split) return { reason: REASONS.repeat };
  return { key, pair };
}
