// What validation, slider ranges and the code writer share: the named sizes of a tree, values worked out from them,
// the faces features sit on, and the rules and footprints that keep the part printable.
import { type Env, type Expr, evaluate } from './scad.ts';

export type Path = (string | number)[];

/** A named size: one slider in the code, tied to one number in the tree. */
export type Size = {
  name: string;
  caption: string;
  value: number;
  step: number;
  /** The printable limits for this size; slider ranges stay inside them. */
  lo: number;
  hi: number;
  path: Path;
};

export type Derived = { name: string; value: Expr };

/** a op b must hold, or the tree is refused with the reason. */
export type Rule = { a: Expr; op: '>=' | '<='; b: Expr; reason: string };

export const ge = (a: Expr, b: Expr, reason: string): Rule => ({ a, op: '>=', b, reason });
export const le = (a: Expr, b: Expr, reason: string): Rule => ({ a, op: '<=', b, reason });

/**
 * A flat face that holes and other features go through or stand on. u and v are positions on the face; the face's
 * material runs from the back surface (at(u, v)) along the normal for `thick` mm.
 */
export type Face = {
  u0: Expr;
  u1: Expr;
  v0: Expr;
  v1: Expr;
  uMid: Expr;
  vMid: Expr;
  uLen: Expr;
  thick: Expr;
  at: (u: Expr, v: Expr) => Expr[];
  normal: 'x' | 'y' | 'z';
  /** the world axes that u and v run along */
  uAxis: 'x' | 'y';
  vAxis: 'x' | 'y' | 'z';
  /** true when the face lies flat while printing, so holes through it are upright */
  flat: boolean;
  corner?: { kind: 'round' | 'chamfer'; size: Expr };
};

/** A shape on a face, in numbers: a circle or a box. cut: material is taken away there. head: a screw head's radius. */
export type Shape = { face: string; cut: boolean; what: string; edge?: boolean } & (
  | { u: number; v: number; r: number; head?: number }
  | { u0: number; v0: number; u1: number; v1: number }
);

export type Extent = { x: Expr; y: Expr; z: Expr };

export type Piece = {
  sizes: Size[];
  derived: Derived[];
  rules: Rule[];
  shapes: (env: Env) => Shape[];
  extent: Partial<Extent>;
  /** axes where the piece cuts into the outer edge, so the extent is only an upper bound */
  trims?: Axis[];
};

export type Axis = 'x' | 'y' | 'z';

export type Model = {
  sizes: Size[];
  derived: Derived[];
  faces: Record<string, Face>;
  rules: Rule[];
  shapes: (env: Env) => Shape[];
  extent: Extent;
  /** true on an axis where the extent is the part's real overall size */
  exact: Record<Axis, boolean>;
};

export function size(path: Path, value: number, name: string, caption: string, step: number, lo: number, hi: number): Size {
  return { name, caption, value, step, lo, hi, path };
}


/** The values of every size and worked-out value, with some sizes changed. */
export function envOf(model: Model, changes: Env = {}): Env {
  const env: Env = {};
  for (const s of model.sizes) env[s.name] = changes[s.name] ?? s.value;
  for (const d of model.derived) env[d.name] = evaluate(d.value, env);
  return env;
}
