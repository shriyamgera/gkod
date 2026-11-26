// Puts a tree's body and features together into one model.
import { bodyPiece } from './bodies.ts';
import { featurePiece } from './features.ts';
import type { Extent, Model, Shape } from './model.ts';
import { type Expr, max } from './scad.ts';
import type { Tree } from './tree.ts';

export function modelOf(tree: Tree): Model {
  const body = bodyPiece(tree.body);
  const pieces = [body, ...tree.features.map((feature, index) => featurePiece(feature, { body: tree.body, faces: body.faces, index }))];
  const sizes = pieces.flatMap((piece) => piece.sizes);
  const names = new Set<string>();
  for (const s of sizes) {
    if (names.has(s.name)) throw new Error(`Two sizes are named ${s.name}.`);
    names.add(s.name);
  }
  const extent = {} as Extent;
  for (const axis of ['x', 'y', 'z'] as const) {
    const all: Expr[] = pieces.map((piece) => piece.extent[axis]).filter((e): e is Expr => e !== undefined);
    extent[axis] = all.length === 1 ? all[0]! : max(...all);
  }
  return {
    sizes,
    derived: pieces.flatMap((piece) => piece.derived),
    faces: body.faces,
    rules: pieces.flatMap((piece) => piece.rules),
    shapes: (env) => pieces.flatMap((piece): Shape[] => piece.shapes(env)),
    extent,
  };
}
