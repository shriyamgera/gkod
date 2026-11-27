// Tree to OpenSCAD in the site's format: a title line, the named sizes with captions and slider ranges, the hidden
// values, the modules and the call. Everything is built from the basic shapes in scad.ts; no part is written as text.
import type { Model } from './model.ts';
import { modelOf } from './part.ts';
import { rangesOf } from './ranges.ts';
import { difference, type Module, type Node, type Param, print, type Program, union } from './scad.ts';
import { bodyShapes } from './shapes/bodies.ts';
import { featureShapes } from './shapes/features.ts';
import type { Tree } from './tree.ts';

/** How finely curves are drawn: 48 sides keep a point at each axis, so round parts measure their full size. */
export const FN = 48;

const ROUND = new Set(['cylinder', 'circle', 'sphere']);

function usesCurves(nodes: Node[]): boolean {
  return nodes.some(
    (node) =>
      (ROUND.has(node.name) && !node.named?.some(([name]) => name === '$fn')) ||
      (node.name === 'offset' && node.named?.[0]?.[0] === 'r') ||
      usesCurves(node.kids ?? []),
  );
}

export function programOf(tree: Tree, model: Model, params: Param[], title: string): Program {
  const parts = [bodyShapes(tree), ...tree.features.map((feature) => featureShapes(feature, tree, model))];
  const modules: Module[] = parts.flatMap((part) => part.modules);
  const adds = parts.flatMap((part) => part.adds);
  const cuts = parts.flatMap((part) => part.cuts);
  const solid = adds.length === 1 ? adds[0]! : union(...adds);
  const main = cuts.length ? difference(solid, ...cuts) : solid;
  const curves = usesCurves(modules.flatMap((module) => module.body));
  return {
    title,
    params,
    hidden: [...(curves ? [{ name: '$fn', value: FN }] : []), ...model.derived],
    modules,
    main: [main],
  };
}

export type Written = { code: string; params: Param[]; model: Model };

/** The part's code, or the reason it cannot be written (a size with no room for a slider). */
export function serialize(tree: Tree, title: string): Written | { reason: string } {
  const model = modelOf(tree);
  const ranges = rangesOf(model);
  if ('reason' in ranges) return ranges;
  return { code: print(programOf(tree, model, ranges.params, title)), params: ranges.params, model };
}
