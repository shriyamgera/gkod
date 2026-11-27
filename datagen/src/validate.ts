// The rules that keep a tree printable and sensible. Every problem comes back as a plain sentence.
import { envOf, type Face, type Model, type Shape } from './model.ts';
import { modelOf } from './part.ts';
import { type Env, evaluate } from './scad.ts';
import { ALLOWED, LIMITS, type Tree } from './tree.ts';

const W = LIMITS.wall;
/** Gap between a cut and something that stands on the same face. */
const BESIDE = 1;
const EPS = 1e-9;

const unique = (reasons: string[]) => [...new Set(reasons)];

function numbers(value: unknown, out: number[] = []): number[] {
  if (typeof value === 'number') out.push(value);
  else if (Array.isArray(value)) value.forEach((item) => numbers(item, out));
  else if (value && typeof value === 'object') Object.values(value).forEach((item) => numbers(item, out));
  return out;
}

/** Checks what features go where, before any size is looked at. */
export function structure(tree: Tree): string[] {
  const allowed = ALLOWED[tree.body.kind];
  if (!allowed) return [`There is no body called ${tree.body.kind}.`];
  const reasons: string[] = [];
  if (numbers(tree).some((n) => !Number.isFinite(n) || n < 0)) reasons.push('Every size must be a number of zero or more.');
  const seen = new Set<string>();
  for (const f of tree.features) {
    const face = 'face' in f ? f.face : '';
    if (!allowed.features.includes(f.kind)) reasons.push(`A ${tree.body.kind} cannot have ${f.kind}.`);
    if ('face' in f && !(f.face in allowed.faces)) reasons.push(`A ${tree.body.kind} has no ${f.face} face.`);
    if (seen.has(`${f.kind}@${face}`)) reasons.push(`Only one set of ${f.kind} goes on each face.`);
    seen.add(`${f.kind}@${face}`);
    if (f.kind === 'holes' && f.face in allowed.faces && !allowed.faces[f.face]!.includes(f.place.pattern)) {
      reasons.push(`Holes cannot sit in a ${f.place.pattern} pattern on the ${f.face} face.`);
    }
    if (f.kind === 'holes' && f.countersink && tree.body.kind === 'clip') reasons.push('Holes in a clip pad are not countersunk.');
    if (f.kind === 'slots' && f.face === 'upright') reasons.push('Slots go only through faces that lie flat.');
    if ((f.kind === 'slots' || f.kind === 'gussets') && f.count !== 1 && f.count !== 2) reasons.push(`There can be one or two ${f.kind}.`);
    if (f.kind === 'flange' && f.holes === 1) reasons.push('A flange has no holes or two or more.');
  }
  if (seen.has('lip@') && seen.has('notch@')) reasons.push('A plate takes a rim or a notch, not both.');
  return reasons;
}

const isCircle = (s: Shape): s is Shape & { u: number; v: number; r: number } => 'r' in s;

function bounds(s: Shape) {
  return isCircle(s) ? { u0: s.u - s.r, v0: s.v - s.r, u1: s.u + s.r, v1: s.v + s.r } : s;
}

/** Room between two shapes; below zero when they overlap. */
export function gap(a: Shape, b: Shape): number {
  if (isCircle(a) && isCircle(b)) return Math.hypot(a.u - b.u, a.v - b.v) - a.r - b.r;
  if (isCircle(a) || isCircle(b)) {
    const c = (isCircle(a) ? a : b) as Shape & { u: number; v: number; r: number };
    const r = bounds(isCircle(a) ? b : a);
    const du = Math.max(r.u0 - c.u, 0, c.u - r.u1);
    const dv = Math.max(r.v0 - c.v, 0, c.v - r.v1);
    const inside = du === 0 && dv === 0;
    return inside ? -c.r : Math.hypot(du, dv) - c.r;
  }
  const p = bounds(a);
  const q = bounds(b);
  const du = Math.max(p.u0 - q.u1, q.u0 - p.u1);
  const dv = Math.max(p.v0 - q.v1, q.v0 - p.v1);
  if (du < 0 && dv < 0) return Math.max(du, dv);
  return Math.hypot(Math.max(du, 0), Math.max(dv, 0));
}

// Room between a shape and a rounded or chamfered corner of its face, measured in the corner's own frame.
function cornerRoom(s: Shape, face: Face, env: Env): number {
  if (!face.corner) return Infinity;
  const size = evaluate(face.corner.size, env);
  if (size <= 0) return Infinity;
  const [u0, u1, v0, v1] = [face.u0, face.u1, face.v0, face.v1].map((e) => evaluate(e, env)) as [number, number, number, number];
  const b = bounds(s);
  const r = isCircle(s) ? s.r : 0;
  let least = Infinity;
  for (const [left, low] of [[true, true], [false, true], [true, false], [false, false]] as const) {
    const a = isCircle(s) ? (left ? s.u - u0 : u1 - s.u) : left ? b.u0 - u0 : u1 - b.u1;
    const c = isCircle(s) ? (low ? s.v - v0 : v1 - s.v) : low ? b.v0 - v0 : v1 - b.v1;
    let room: number;
    if (face.corner.kind === 'chamfer') room = (a + c - size) / Math.SQRT2 - r;
    else room = a < size && c < size ? size - Math.hypot(size - a, size - c) - r : Infinity;
    least = Math.min(least, room);
  }
  return least;
}

/** Checks the sizes, the rules and where every feature sits, for the given values. */
export function check(model: Model, env: Env): string[] {
  const reasons: string[] = [];
  for (const s of model.sizes) {
    const value = env[s.name]!;
    const what = s.caption.replace(/ \(mm\)$/, '');
    if (value < s.lo - EPS || value > s.hi + EPS) reasons.push(`${what} must be from ${s.lo} to ${s.hi}.`);
    if (s.name.endsWith('_count') && !Number.isInteger(value)) reasons.push(`${what} must be a whole number.`);
  }
  for (const rule of model.rules) {
    const a = evaluate(rule.a, env);
    const b = evaluate(rule.b, env);
    if (!(rule.op === '>=' ? a >= b - EPS : a <= b + EPS)) reasons.push(rule.reason);
  }
  for (const axis of ['x', 'y', 'z'] as const) {
    if (evaluate(model.extent[axis], env) > LIMITS.part + EPS) reasons.push(`The part is bigger than ${LIMITS.part} mm along ${axis}.`);
  }
  if (reasons.length) return unique(reasons);

  const shapes = model.shapes(env);
  for (const s of shapes) {
    const face = model.faces[s.face]!;
    if (s.edge) continue;
    const m = s.cut ? W : 0;
    const b = bounds(s);
    const [u0, u1, v0, v1] = [face.u0, face.u1, face.v0, face.v1].map((e) => evaluate(e, env)) as [number, number, number, number];
    if (b.u0 < u0 + m - EPS || b.u1 > u1 - m + EPS || b.v0 < v0 + m - EPS || b.v1 > v1 - m + EPS) {
      reasons.push(s.cut ? `A ${s.what} is too close to the edge.` : `A ${s.what} hangs over the edge.`);
    } else if (cornerRoom(s, face, env) < m - EPS) {
      reasons.push(`A ${s.what} is too close to a ${face.corner!.kind === 'round' ? 'rounded' : 'chamfered'} corner.`);
    }
  }
  for (let i = 0; i < shapes.length; i++) {
    for (let j = i + 1; j < shapes.length; j++) {
      const [a, b] = [shapes[i]!, shapes[j]!];
      if (a.face !== b.face || (!a.cut && !b.cut)) continue;
      const need = a.cut && b.cut ? W : BESIDE;
      if (gap(a, b) < need - EPS) {
        reasons.push(a.what === b.what ? `Two ${a.what}s are too close together.` : `A ${a.what} and a ${b.what} are too close together.`);
        continue;
      }
      // a screw in a hole needs room for its head beside anything that stands on the face
      const [cut, solid] = a.cut ? [a, b] : [b, a];
      if (!solid.cut && isCircle(cut) && cut.head !== undefined && gap({ ...cut, r: Math.max(cut.r, cut.head) }, solid) < BESIDE - EPS) {
        reasons.push(`A screw head in a ${cut.what} would hit a ${solid.what}.`);
      }
    }
  }
  return unique(reasons);
}

/** Every reason the tree cannot be made, or an empty list when it is fine. */
export function validate(tree: Tree): string[] {
  const reasons = structure(tree);
  if (reasons.length) return reasons;
  const model = modelOf(tree);
  return check(model, envOf(model));
}
