// The design of the frozen sets: which families each split holds, which feature pairs are kept out of training, the
// seeds and the counts. Everything here is fixed for set v1; a change means a new set version.
import { FAMILIES } from '../families/index.ts';
import type { Tree } from '../tree.ts';

export const SET_VERSION = 'v1';

export type Split = 'train' | 'dev' | 'test';
export const SPLITS: readonly Split[] = ['train', 'dev', 'test'];

/** How much code a family's parts need: by the median number of named sizes in a 6,000-part run (seed 7). */
export type Level = 'simple' | 'medium' | 'harder';

export const LEVELS: Record<string, Level> = {
  // 3 to 5 named sizes
  spacer: 'simple', washer: 'simple', cup: 'simple', foot: 'simple', coaster: 'simple', divider: 'simple', grommet: 'simple',
  // 6 or 7
  plate: 'medium', clip: 'medium', saddle: 'medium', slot_plate: 'medium', channel: 'medium', tray: 'medium', knob: 'medium',
  hook: 'medium', corner_plate: 'medium',
  // 8 or more
  battery_holder: 'harder', handle: 'harder', comb: 'harder', bracket: 'harder', shelf: 'harder', bit_holder: 'harder',
  enclosure: 'harder', tool_holder: 'harder',
};

/**
 * Each family is in exactly one split. Dev and test each have simple, medium and harder families, and some that share
 * a body with a training family (washer: spacer's round body; slot_plate: the plate; enclosure: tray's box) and some
 * with a body no training family has (foot, saddle, handle; corner_plate, comb).
 */
export const FAMILY_SPLIT: Record<Split, readonly string[]> = {
  train: [
    'plate', 'bracket', 'channel', 'tray', 'spacer', 'hook', 'knob', 'clip',
    'shelf', 'tool_holder', 'divider', 'grommet', 'cup', 'bit_holder', 'battery_holder',
  ],
  dev: ['coaster', 'comb', 'corner_plate'],
  test: ['washer', 'slot_plate', 'enclosure', 'foot', 'saddle', 'handle'],
};

export type Pair = readonly [string, string];

/**
 * Feature pairs never seen together in training: each feature of a pair is in training parts, but no training part
 * (and no training edit, on either side) has both. A dev pair is only in dev parts and a test pair only in test parts.
 */
export const HELD_OUT: Record<'dev' | 'test', readonly Pair[]> = {
  dev: [
    ['holes@top', 'lip'], // plate: holes and a rim
    ['dividers', 'tabs'], // tray: compartments and mounting tabs
    ['gussets', 'slots@base'], // bracket: gussets and slots in the base
    ['holes@floor', 'lips'], // channel: floor holes and inward lips
  ],
  test: [
    ['holes@top', 'notch'], // plate: holes and a notch
    ['holes@top', 'ribs'], // plate: holes and ribs
    ['holes@floor', 'tabs'], // tray: floor holes and mounting tabs
    ['holes@upright', 'slots@base'], // bracket: upright holes and slots in the base
    ['flat', 'grips'], // knob: grip notches and a D-shaped shaft hole
  ],
};

export type Tier = 'train' | 't1' | 't2' | 't3' | 'edit';

/** What each tier of dev and test holds, in the words of the plan: new sizes, new feature pairs, new families. */
export const TIERS = {
  t1: 'new sizes for training families: other seeds, no tree within 0.5 mm of a training part, no held-out pair',
  t2: 'training families with exactly one of the split\'s held-out feature pairs',
  t3: 'families no training part has',
} as const;

/** Run seeds: every piece has its own, so no two pieces share a part seed by design. */
export const SEEDS = {
  train: { create: 101, edit: 102 },
  dev: { t1: 201, t2: 202, t3: 203, edit: 204 },
  test: { t1: 301, t2: 302, t3: 303, edit: 304 },
} as const;

export type Counts = { train: { create: number; edit: number }; holdout: { t1: number; t2: number; t3: number; edit: number } };

/** Rows in each piece; dev and test have the same structure. */
export const COUNTS: Counts = { train: { create: 6000, edit: 3000 }, holdout: { t1: 100, t2: 100, t3: 100, edit: 100 } };

/** Two trees of the same family and shape whose numbers all differ by at most this much are near-copies (mm). */
export const NEAR_MM = 0.5;

/** The feature tokens of a tree: each feature's kind, with its face for holes, slots and pockets. */
export function featureTokens(tree: Tree): string[] {
  return [...new Set(tree.features.map((f) => ('face' in f ? `${f.kind}@${f.face}` : f.kind)))].sort();
}

/** A pair as one string, such as holes@top+lip. */
export const pairKey = (pair: Pair) => [...pair].sort().join('+');

/** The held-out pairs a tree has, from one list. */
export function pairsIn(tree: Tree, pairs: readonly Pair[]): Pair[] {
  const tokens = new Set(featureTokens(tree));
  return pairs.filter(([a, b]) => tokens.has(a) && tokens.has(b));
}

/** The held-out pairs a part of this split must not have: every pair for train, the other split's for dev and test. */
export function forbiddenPairs(split: Split): readonly Pair[] {
  if (split === 'train') return [...HELD_OUT.dev, ...HELD_OUT.test];
  return HELD_OUT[split === 'dev' ? 'test' : 'dev'];
}

/** Which split a family's parts are new in, or 'train'. */
export function splitOfFamily(family: string): Split {
  const found = SPLITS.find((split) => FAMILY_SPLIT[split].includes(family));
  if (!found) throw new Error(`Family ${family} is in no split.`);
  return found;
}

/** Problems with the design itself, as plain sentences; empty when it holds. */
export function designProblems(): string[] {
  const problems: string[] = [];
  const all = SPLITS.flatMap((split) => FAMILY_SPLIT[split]);
  const ids = FAMILIES.map((family) => family.id);
  for (const id of ids) {
    const n = all.filter((family) => family === id).length;
    if (n !== 1) problems.push(`Family ${id} is in ${n} splits.`);
    if (!LEVELS[id]) problems.push(`Family ${id} has no level.`);
  }
  for (const family of all) if (!ids.includes(family)) problems.push(`There is no family ${family}.`);
  if (FAMILY_SPLIT.dev.length < 3) problems.push('Dev needs at least 3 families of its own.');
  if (FAMILY_SPLIT.test.length < 6) problems.push('Test needs at least 6 families of its own.');
  for (const split of SPLITS) {
    const levels = new Set(FAMILY_SPLIT[split].map((family) => LEVELS[family]));
    if (levels.size < 3) problems.push(`The ${split} families do not have a simple, a medium and a harder family.`);
  }
  const keys = [...HELD_OUT.dev, ...HELD_OUT.test].map(pairKey);
  if (new Set(keys).size !== keys.length) problems.push('A held-out pair is listed twice.');
  if (keys.length < 8) problems.push('There must be at least 8 held-out pairs.');
  for (const [a, b] of [...HELD_OUT.dev, ...HELD_OUT.test]) if (a >= b) problems.push(`Write the pair ${a} + ${b} in sorted order.`);
  return problems;
}
