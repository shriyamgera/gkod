import { beforeAll, describe, expect, it } from 'vitest';
import { FAMILIES, sampleTree } from '../src/families/index.ts';
import { Rng } from '../src/rng.ts';
import type { Row } from '../src/run.ts';
import { treeHash } from '../src/run.ts';
import type { Tree } from '../src/tree.ts';
import {
  designProblems, FAMILY_SPLIT, featureTokens, forbiddenPairs, HELD_OUT, LEVELS, pairKey, pairsIn, SEEDS, splitOfFamily, SPLITS,
} from '../src/splits/design.ts';
import { planEdits, planPiece } from '../src/splits/plan.ts';
import { createPieces, judge, Ledger, NearIndex, type Piece, REASONS, shapeOf, shares } from '../src/splits/rules.ts';

const generator = { name: 'gkod-datagen', version: '0.1.0', commit: 'test', dirty: false };

/** The first sampled tree that passes `test`, so the tests use real trees rather than hand-made ones. */
function find(test: (tree: Tree) => boolean, seed = 99): Tree {
  const rng = new Rng(seed);
  for (let i = 0; i < 300_000; i++) {
    const tree = sampleTree(rng.child(i));
    if (test(tree)) return tree;
  }
  throw new Error('No such tree.');
}
const has = (...tokens: string[]) => (tree: Tree) => {
  const own = featureTokens(tree);
  return tokens.every((token) => own.includes(token));
};
const only = (...tokens: string[]) => (tree: Tree) => featureTokens(tree).join(' ') === [...tokens].sort().join(' ');

describe('set design', () => {
  it('puts every family in exactly one split, with at least 3 dev and 6 test families and every level in each', () => {
    expect(designProblems()).toEqual([]);
    const all = SPLITS.flatMap((split) => FAMILY_SPLIT[split]);
    expect([...all].sort()).toEqual(FAMILIES.map((family) => family.id).sort());
    expect(FAMILY_SPLIT.dev.length).toBeGreaterThanOrEqual(3);
    expect(FAMILY_SPLIT.test.length).toBeGreaterThanOrEqual(6);
    for (const split of SPLITS) expect(new Set(FAMILY_SPLIT[split].map((family) => LEVELS[family]))).toEqual(new Set(['simple', 'medium', 'harder']));
    expect(splitOfFamily('washer')).toBe('test');
    expect(splitOfFamily('comb')).toBe('dev');
    expect(splitOfFamily('plate')).toBe('train');
  });

  it('holds out at least 8 feature pairs, dev and test apart, each made by a training family and each feature seen without the other', () => {
    const pairs = [...HELD_OUT.dev, ...HELD_OUT.test];
    expect(pairs.length).toBeGreaterThanOrEqual(8);
    expect(HELD_OUT.dev.length).toBeGreaterThan(0);
    expect(HELD_OUT.test.length).toBeGreaterThan(0);
    expect(new Set(pairs.map(pairKey)).size).toBe(pairs.length);
    const train = (tree: Tree) => FAMILY_SPLIT.train.includes(tree.family);
    for (const [a, b] of pairs) {
      expect(find((tree) => train(tree) && has(a, b)(tree)).family).toBeTruthy();
      // each feature turns up in training parts that have no held-out pair at all
      for (const token of [a, b]) expect(find((tree) => train(tree) && has(token)(tree) && !pairsIn(tree, pairs).length).family).toBeTruthy();
    }
  });

  it('names features by kind and face, without corner shapes or countersinks', () => {
    const bracket = find((tree) => tree.family === 'bracket' && has('gussets', 'holes@base', 'holes@upright')(tree));
    expect(featureTokens(bracket)).toEqual(['gussets', 'holes@base', 'holes@upright']);
    const sunk = find((tree) => tree.family === 'hook' && tree.features.some((f) => f.kind === 'holes' && f.countersink));
    expect(featureTokens(sunk)).toEqual(['holes@plate']);
  });

  it('keeps every pair out of training and the other split\'s pairs out of dev and test', () => {
    expect(forbiddenPairs('train')).toEqual([...HELD_OUT.dev, ...HELD_OUT.test]);
    expect(forbiddenPairs('dev')).toEqual(HELD_OUT.test);
    expect(forbiddenPairs('test')).toEqual(HELD_OUT.dev);
  });

  it('gives each piece its own seed', () => {
    const seeds = [SEEDS.train.create, SEEDS.train.edit, ...Object.values(SEEDS.dev), ...Object.values(SEEDS.test)];
    expect(new Set(seeds).size).toBe(seeds.length);
  });
});

describe('near-copies', () => {
  const spacer = find((tree) => tree.family === 'spacer' && !tree.features.length);
  const moved = (tree: Tree, by: number): Tree => {
    const copy = structuredClone(tree);
    (copy.body as { height: number }).height += by;
    return copy;
  };

  it('finds a tree of the same shape with every number within 0.5 mm, and nothing else', () => {
    const index = new NearIndex();
    index.add(spacer);
    expect(index.has(spacer)).toBe(true);
    expect(index.has(moved(spacer, 0.5))).toBe(true);
    expect(index.has(moved(spacer, -0.5))).toBe(true);
    expect(index.has(moved(spacer, 0.6))).toBe(false);
    const hex = structuredClone(spacer);
    (hex.body as { hex: boolean }).hex = !(spacer.body as { hex: boolean }).hex;
    expect(index.has(hex)).toBe(false);
    // the family's name is not geometry: a part of another family drawn the same way is a near-copy too
    expect(index.has({ ...spacer, family: 'washer' })).toBe(true);
    expect(index.has({ ...moved(spacer, 0.6), family: 'washer' })).toBe(false);
  });

  it('reads the numbers in the same order whatever order the keys were written in', () => {
    const flipped = { features: spacer.features, body: Object.fromEntries(Object.entries(spacer.body).reverse()), family: spacer.family } as Tree;
    expect(shapeOf(flipped)).toEqual(shapeOf(spacer));
    expect(shapeOf({ ...spacer, family: 'washer' })).toEqual(shapeOf(spacer));
  });
});

describe('split rules', () => {
  const plateWith = (...tokens: string[]) => find((tree) => tree.family === 'plate' && only(...tokens)(tree));
  const piece = (split: Piece['split'], tier: Piece['tier'], quota?: Map<string, number>): Piece => ({
    split, tier, seed: 1, count: 10, families: tier === 't3' ? FAMILY_SPLIT[split] : FAMILY_SPLIT.train, quota,
  });
  const verdict = (p: Piece, tree: Tree, ledger = new Ledger(), taken = new Map<string, number>()) => judge(p, tree, treeHash(tree), ledger, taken);

  it('lets a held-out pair into tier 2 of its own split only', () => {
    const rim = plateWith('holes@top', 'lip');
    expect(verdict(piece('train', 'train'), rim)).toEqual({ reason: REASONS.heldOut });
    expect(verdict(piece('test', 't2'), rim)).toEqual({ reason: REASONS.heldOut });
    expect(verdict(piece('dev', 't1'), rim)).toEqual({ reason: REASONS.ownPair });
    expect(verdict(piece('dev', 't2'), rim)).toEqual({ key: 'holes@top+lip', pair: ['holes@top', 'lip'] });
    expect(verdict(piece('dev', 't2'), plateWith('holes@top'))).toEqual({ reason: REASONS.noPair });
    expect(verdict(piece('train', 'train'), plateWith('holes@top'))).toEqual({ key: null, pair: null });
  });

  it('keeps a tier 2 part with two pairs out, and one with the other split\'s pair', () => {
    const notch = plateWith('holes@top', 'notch');
    const both = structuredClone(notch);
    both.features.push(plateWith('ribs').features[0]!);
    expect(verdict(piece('test', 't2'), both)).toEqual({ reason: REASONS.twoPairs });
    const mixed = structuredClone(notch);
    mixed.features.push(plateWith('lip').features[0]!);
    expect(verdict(piece('test', 't2'), mixed)).toEqual({ reason: REASONS.heldOut });
    expect(verdict(piece('dev', 't2'), mixed)).toEqual({ reason: REASONS.heldOut });
  });

  it('takes tier 3 parts only from the split\'s own families, and tier 1 only from training families', () => {
    const comb = find((tree) => tree.family === 'comb');
    const washer = find((tree) => tree.family === 'washer');
    expect(verdict(piece('dev', 't3'), comb)).toEqual({ key: 'comb', pair: null });
    expect(verdict(piece('test', 't3'), comb)).toEqual({ reason: REASONS.family });
    expect(verdict(piece('test', 't3'), washer)).toEqual({ key: 'washer', pair: null });
    expect(verdict(piece('dev', 't1'), washer)).toEqual({ reason: REASONS.family });
    expect(verdict(piece('train', 'train'), comb)).toEqual({ reason: REASONS.family });
  });

  it('stops a family or pair at its share', () => {
    const comb = find((tree) => tree.family === 'comb');
    const p = piece('dev', 't3', new Map([['comb', 2]]));
    expect(verdict(p, comb, new Ledger(), new Map([['comb', 1]]))).toEqual({ key: 'comb', pair: null });
    expect(verdict(p, comb, new Ledger(), new Map([['comb', 2]]))).toEqual({ reason: REASONS.quota });
  });

  it('keeps a tree, or a near-copy of it, out of a second split', () => {
    const spacer = find((tree) => tree.family === 'spacer' && !tree.features.length);
    const ledger = new Ledger();
    ledger.add('train', spacer, treeHash(spacer));
    expect(verdict(piece('dev', 't1'), spacer, ledger)).toEqual({ reason: REASONS.otherSplit });
    const near = structuredClone(spacer);
    (near.body as { diameter: number }).diameter += 0.5;
    expect(verdict(piece('dev', 't1'), near, ledger)).toEqual({ reason: REASONS.nearOther });
    expect(verdict(piece('train', 'train'), spacer, ledger)).toEqual({ reason: REASONS.repeat });
    expect(() => ledger.add('test', spacer, treeHash(spacer))).toThrow(/already in train/);
  });

  it('shares a tier out evenly, the first keys taking what is left over', () => {
    const quota = shares(FAMILY_SPLIT.train, 100);
    expect([...quota.values()].reduce((x, y) => x + y, 0)).toBe(100);
    expect([...quota.values()]).toEqual([...Array(10).fill(7), ...Array(5).fill(6)]);
    expect([...shares(['a', 'b', 'c'], 100).values()]).toEqual([34, 33, 33]);
  });
});

describe('picking a set', () => {
  const counts = { train: 240, t1: 15, t2: 10, t3: 9 };
  const pick = () => {
    const ledger = new Ledger();
    const plans = createPieces(counts, { train: SEEDS.train.create, dev: SEEDS.dev, test: SEEDS.test }).map((piece) => planPiece(piece, ledger, generator));
    return { ledger, plans };
  };

  let first: ReturnType<typeof pick>;
  let second: ReturnType<typeof pick>;
  beforeAll(() => {
    first = pick();
    second = pick();
  }, 120000);

  it('picks the same parts every time', () => {
    const strip = (plans: ReturnType<typeof pick>['plans']) => JSON.stringify(plans.map((p) => ({ ...p, piece: { ...p.piece, quota: [...(p.piece.quota ?? [])] } })));
    expect(strip(first.plans)).toBe(strip(second.plans));
  });

  it('follows every split rule, with no tree and no near-copy in two splits', () => {
    const { plans } = first;
    const bySplit = new Map<string, Tree[]>();
    for (const p of plans) {
      expect(p.parts).toHaveLength(p.piece.count);
      for (const { part, pair } of p.parts) {
        const tree = part.row!.tree;
        expect(part.row!.seed).toBe(p.piece.seed);
        expect(p.piece.families).toContain(tree.family);
        expect(pairsIn(tree, forbiddenPairs(p.piece.split))).toEqual([]);
        if (p.piece.tier === 't2') {
          expect(pairsIn(tree, HELD_OUT[p.piece.split as 'dev' | 'test'])).toEqual([pair]);
        } else {
          expect(pair).toBeNull();
          if (p.piece.split !== 'train') expect(pairsIn(tree, HELD_OUT[p.piece.split as 'dev' | 'test'])).toEqual([]);
        }
        bySplit.set(p.piece.split, [...(bySplit.get(p.piece.split) ?? []), tree]);
      }
      if (p.piece.quota) {
        const keys = p.parts.map(({ part, pair }) => (pair ? pairKey(pair) : part.row!.family));
        for (const [key, n] of p.piece.quota) expect(keys.filter((k) => k === key)).toHaveLength(n);
      }
    }
    for (const split of SPLITS) {
      const others = SPLITS.filter((s) => s !== split).flatMap((s) => bySplit.get(s)!);
      const index = new NearIndex();
      others.forEach((tree) => index.add(tree));
      const hashes = new Set(others.map(treeHash));
      for (const tree of bySplit.get(split)!) {
        expect(hashes.has(treeHash(tree))).toBe(false);
        expect(index.has(tree)).toBe(false);
      }
    }
    const ids = plans.flatMap((p) => p.parts.map(({ part }) => part.row!.id));
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('makes edit pairs inside a split, never with another split\'s tree or a held-out pair in training', () => {
    const { ledger, plans } = first;
    const sources = plans.filter((p) => p.piece.split === 'train').flatMap((p) => p.parts.map(({ part }) => part.row! as Row));
    const before = ledger.others('train');
    const edits = planEdits({ split: 'train', seed: SEEDS.train.edit, count: 60, sources, fileSha256: 'x', ledger, generator });
    expect(edits.pairs).toHaveLength(60);
    for (const { pair } of edits.pairs) {
      expect(sources.some((row) => row.id === pair!.source.id)).toBe(true);
      expect(before.has(pair!.b.tree_sha256)).toBe(false);
      expect(pairsIn(pair!.b.tree, forbiddenPairs('train'))).toEqual([]);
      expect(ledger.hashes.get(pair!.b.tree_sha256)).toBe('train');
    }
    const again = planEdits({ split: 'train', seed: SEEDS.train.edit, count: 60, sources, fileSha256: 'x', ledger: second.ledger, generator });
    expect(JSON.stringify(again)).toBe(JSON.stringify(edits));
  }, 60000);

  it('refuses edit sources that another split holds', () => {
    const { ledger, plans } = first;
    const sources = plans.filter((p) => p.piece.split === 'dev').flatMap((p) => p.parts.map(({ part }) => part.row! as Row));
    expect(() => planEdits({ split: 'train', seed: 1, count: 1, sources, fileSha256: 'x', ledger, generator })).toThrow(/in another split/);
  });
});
