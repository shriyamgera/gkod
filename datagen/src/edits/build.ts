// The edited part: tree B checked with the generator's rules, its title and its code. Code B keeps the slider range
// of every size whose old range still holds for the new part, so only what the edit touches changes in the code.
import { envOf, type Model } from '../model.ts';
import { modelOf } from '../part.ts';
import { holeCount } from '../phrases.ts';
import { rangesOf } from '../ranges.ts';
import { Rng } from '../rng.ts';
import { type Param, print } from '../scad.ts';
import { programOf } from '../serialize.ts';
import type { Feature, Tree } from '../tree.ts';
import { check, validate } from '../validate.ts';
import { count, styleOf } from '../words.ts';
import { type Side, stepsOf } from './ops.ts';

/** The part a source row describes, as the edits see it. */
export function sideOf(tree: Tree): Side | { reason: string } {
  const model = modelOf(tree);
  const ranges = rangesOf(model);
  if ('reason' in ranges) return ranges;
  return { tree, model, env: envOf(model), params: ranges.params };
}

/** True when every value of the old slider range still passes every rule on the new part, moving that size alone. */
function holds(model: Model, now: Param, old: Param): boolean {
  if (old.step !== now.step || old.caption !== now.caption) return false;
  const at = (now.value - old.min) / old.step;
  if (now.value < old.min - 1e-9 || now.value > old.max + 1e-9 || Math.abs(at - Math.round(at)) > 1e-6) return false;
  return stepsOf(old).every((value) => Math.abs(value - now.value) < 1e-9 || check(model, envOf(model, { [now.name]: value })).length === 0);
}

/** The new part's sliders: the old range where it still holds, otherwise a range worked out afresh. */
export function keepRanges(model: Model, fresh: Param[], before: Param[]): Param[] {
  const old = new Map(before.map((p) => [p.name, p]));
  return fresh.map((p) => {
    const was = old.get(p.name);
    return was && holds(model, p, was) ? { ...p, min: was.min, max: was.max } : p;
  });
}

const HOLES = / with (a hole|\S+ holes)$/;

/**
 * The title of the edited part, by the request's own rule: the part's name, and its holes counted when there are no
 * tabs or standoffs, in the same number style as the source request (its first draw), at most 40 characters.
 */
export function titleOf(source: { title: string; part_seed: number }, tree: Tree): string {
  let base = source.title.replace(HOLES, '');
  // a plate with nothing to fix it by is not called a mounting plate
  if (base === 'Mounting plate' && !tree.features.some((f) => ['holes', 'slots', 'bosses'].includes(f.kind))) base = 'Plate';
  const sets = tree.features.filter((f): f is Extract<Feature, { kind: 'holes' }> => f.kind === 'holes');
  if (!sets.length || tree.features.some((f) => f.kind === 'tabs' || f.kind === 'bosses')) return base;
  const n = sets.reduce((sum, f) => sum + holeCount(f.place), 0);
  const title = `${base} with ${n === 1 ? 'a hole' : `${count(styleOf(new Rng(source.part_seed).child(2)), n)} holes`}`;
  return title.length <= 40 ? title : base;
}

export type Built = Side & { title: string; code: string };

/** The edited part with its code, or the first reason it cannot be made. */
export function buildB(source: { title: string; part_seed: number }, before: Param[], tree: Tree): Built | { reason: string } {
  const reasons = validate(tree);
  if (reasons.length) return { reason: reasons[0]! };
  const model = modelOf(tree);
  const fresh = rangesOf(model);
  if ('reason' in fresh) return fresh;
  const params = keepRanges(model, fresh.params, before);
  const title = titleOf(source, tree);
  return { tree, model, env: envOf(model), params, title, code: print(programOf(tree, model, params, title)) };
}

export type SizeDiff = {
  /** sizes in both parts whose value changed */
  changed: { name: string; from: number; to: number }[];
  /** sizes only the new part has */
  added: { name: string; value: number }[];
  /** sizes only the old part had */
  removed: { name: string; value: number }[];
  /** every other size: the same name and value in both */
  kept: { name: string; value: number }[];
};

/** How two size blocks differ, by name and value, in the order each block lists its sizes. */
export function diffSizes(before: { name: string; value: number }[], after: { name: string; value: number }[]): SizeDiff {
  const a = new Map(before.map((p) => [p.name, p.value]));
  const b = new Map(after.map((p) => [p.name, p.value]));
  return {
    changed: after.filter((p) => a.has(p.name) && a.get(p.name) !== p.value).map((p) => ({ name: p.name, from: a.get(p.name)!, to: p.value })),
    added: after.filter((p) => !a.has(p.name)).map((p) => ({ name: p.name, value: p.value })),
    removed: before.filter((p) => !b.has(p.name)).map((p) => ({ name: p.name, value: p.value })),
    kept: before.filter((p) => b.get(p.name) === p.value).map((p) => ({ name: p.name, value: p.value })),
  };
}
