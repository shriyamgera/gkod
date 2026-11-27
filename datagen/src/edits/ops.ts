// Edit operations on a feature tree, and the edits a part allows. An op says what changes: one named size (by an
// amount or to a value), a count, a whole-part scale, an added or removed feature, or a hole pattern. Applying it gives
// a new tree; the caller checks that tree with the generator's own rules before it is used.
import { bracket } from '../families/bracket.ts';
import { channel } from '../families/channel.ts';
import { fit, holeRoom, placeOn, screwHoles } from '../families/pick.ts';
import { plate } from '../families/plate.ts';
import { spacer } from '../families/spacer.ts';
import { tray } from '../families/tray.ts';
import type { Model, Path } from '../model.ts';
import type { Rng } from '../rng.ts';
import { type Env, evaluate, type Param } from '../scad.ts';
import { ALLOWED, type Corner, type Feature, type FeatureKind, type Tree } from '../tree.ts';

export type EditKind = 'size' | 'hole_d' | 'move' | 'count' | 'scale' | 'add' | 'remove';

export const KINDS: readonly EditKind[] = ['size', 'hole_d', 'move', 'count', 'scale', 'add', 'remove'];

/** One named size, by an amount or to a value. The kind says what sort of size it is. */
export type SizeOp = { kind: 'size' | 'hole_d' | 'move' | 'count'; name: string; mode: 'by' | 'to'; from: number; to: number };
/** A count that is not a named size: one centre hole or a pair of holes, one gusset or two. */
export type ShapeOp = { kind: 'count'; name: null; feature: 'holes' | 'gussets'; face?: string; from: number; to: number; spacing?: number };
export type ScaleOp = { kind: 'scale'; factor: number };
export type AddOp = { kind: 'add'; feature: Feature };
export type RemoveOp = { kind: 'remove'; index: number; feature: Feature };
export type EditOp = SizeOp | ShapeOp | ScaleOp | AddOp | RemoveOp;

/** A part as the edits see it: its tree, sizes and slider ranges. */
export type Side = { tree: Tree; model: Model; env: Env; params: Param[] };

const tidy = (value: number) => Math.round(value * 1e6) / 1e6;

/** What sort of edit a named size takes, or null for a size that people do not ask to change. */
export function sizeKind(name: string): SizeOp['kind'] | null {
  // "opening narrower than the cable by" is how a clip grips; nobody asks for it by number
  if (name === 'snap') return null;
  if (name.endsWith('_count')) return 'count';
  if (/(^|_)(hole_d|bore_d|shaft_d)$/.test(name)) return 'hole_d';
  if (/_(spacing|inset|spacing_x|spacing_y)$/.test(name)) return 'move';
  return 'size';
}

// The order the families list features in, so an added feature sits where a sampled part would have it and the same
// part always has the same tree hash.
const RANK: Partial<Record<FeatureKind, number>> = {
  dividers: 0, bosses: 1, holes: 2, slots: 3, pocket: 5, ribs: 6, lip: 7, notch: 8, tabs: 9, gussets: 10, lips: 11, flange: 12, grips: 13, flat: 14,
};

export const rankOf = (f: Feature) => (f.kind === 'holes' && f.face === 'upright' ? 4 : (RANK[f.kind] ?? 50));

export function inOrder(features: Feature[]): Feature[] {
  return [...features].sort((a, b) => rankOf(a) - rankOf(b));
}

function setAt(tree: Tree, path: Path, value: number): void {
  let node = tree as unknown as Record<string | number, unknown>;
  for (const key of path.slice(0, -1)) node = node[key] as Record<string | number, unknown>;
  node[path[path.length - 1]!] = value;
}

/** The tree after the edit. `model` is the model of `tree`; the tree itself is not changed. */
export function applyOp(tree: Tree, model: Model, op: EditOp): Tree {
  const out = structuredClone(tree);
  switch (op.kind) {
    case 'scale':
      for (const s of model.sizes) if (!s.name.endsWith('_count')) setAt(out, s.path, tidy(s.value * op.factor));
      return out;
    case 'add':
      out.features = inOrder([...out.features, structuredClone(op.feature)]);
      return out;
    case 'remove':
      out.features = out.features.filter((_, i) => i !== op.index);
      return out;
  }
  if (op.name === null) {
    for (const f of out.features) {
      if (op.feature === 'gussets' && f.kind === 'gussets') f.count = op.to;
      if (op.feature === 'holes' && f.kind === 'holes' && f.face === op.face) {
        f.place = op.to === 2 ? { pattern: 'pair', spacing: op.spacing! } : { pattern: 'center' };
      }
    }
    return out;
  }
  const s = model.sizes.find((size) => size.name === op.name);
  if (!s) throw new Error(`The part has no size called ${op.name}.`);
  setAt(out, s.path, op.to);
  return out;
}

// ---- the edits a part allows

/** Steps people change a size by: whole numbers, then halves, then 0.2 mm for walls. */
const NICE: Record<string, number[]> = {
  '1': [1, 2, 3, 4, 5, 10, 15, 20, 25, 30, 40, 50],
  '0.5': [0.5, 1, 1.5, 2, 2.5, 3, 4, 5, 10],
  '0.2': [0.2, 0.4, 0.6, 0.8, 1, 1.2, 1.6, 2],
};

const near = (a: number, b: number) => Math.abs(a - b) < 1e-9;
const isMultiple = (value: number, of: number) => near(value / of, Math.round(value / of));

/** Every value a slider can take. */
export function stepsOf(p: Param): number[] {
  const n = Math.round((p.max - p.min) / p.step);
  return Array.from({ length: n + 1 }, (_, k) => tidy(p.min + k * p.step));
}

/**
 * A new value for one size, inside its slider range: any value there keeps the part valid, since the range was found by
 * moving that one size while every rule still held.
 */
function sizeOp(kind: SizeOp['kind'], p: Param, rng: Rng): SizeOp | null {
  const values = stepsOf(p).filter((v) => !near(v, p.value));
  if (!values.length) return null;
  const base = { kind, name: p.name, from: p.value };
  if (kind === 'count') return { ...base, mode: 'to', to: rng.pick(values.filter((v) => Math.abs(v - p.value) <= 2)) };
  if (rng.chance(0.5)) {
    const deltas = (NICE[String(p.step)] ?? [p.step]).flatMap((d) => [d, -d]).filter((d) => values.some((v) => near(v, p.value + d)));
    if (deltas.length) return { ...base, mode: 'by', to: tidy(p.value + rng.pick(deltas)) };
  }
  // round design sizes come first: 5 mm marks for whole-mm sizes, whole mm for half-mm ones
  const round = values.filter((v) => isMultiple(v, p.step === 1 ? 5 : p.step === 0.5 ? 1 : 0.4));
  return { ...base, mode: 'to', to: round.length && rng.chance(0.7) ? rng.pick(round) : rng.pick(values) };
}

function sizeOps(kind: SizeOp['kind'], side: Side, rng: Rng): SizeOp[] {
  return side.params.flatMap((p) => {
    if (sizeKind(p.name) !== kind) return [];
    const op = sizeOp(kind, p, rng);
    return op ? [op] : [];
  });
}

function shapeOps(side: Side, rng: Rng): ShapeOp[] {
  const out: ShapeOp[] = [];
  for (const f of side.tree.features) {
    if (f.kind === 'gussets') out.push({ kind: 'count', name: null, feature: 'gussets', from: f.count, to: 3 - f.count });
    if (f.kind !== 'holes') continue;
    const patterns = ALLOWED[side.tree.body.kind].faces[f.face] ?? [];
    if (f.place.pattern === 'center' && patterns.includes('pair')) {
      const face = side.model.faces[f.face]!;
      const len = evaluate(face.uLen, side.env);
      const wide = evaluate(face.v1, side.env) - evaluate(face.v0, side.env);
      const place = placeOn(rng, 'pair', len, wide, holeRoom(f.d, f.countersink));
      if (place?.pattern === 'pair') out.push({ kind: 'count', name: null, feature: 'holes', face: f.face, from: 1, to: 2, spacing: place.spacing });
    }
    if (f.place.pattern === 'pair' && patterns.includes('center')) out.push({ kind: 'count', name: null, feature: 'holes', face: f.face, from: 2, to: 1 });
  }
  return out;
}

/** Whole-part scales: each keeps sizes on tidy numbers (a size of 4.5 mm becomes 5.625 at 125%). */
export const FACTORS = [1.2, 1.25, 1.5, 2, 0.8, 0.75] as const;

// Moves corner holes in far enough to clear a rounded or chamfered corner, as the plate family does.
function clearCorner(holes: Feature | undefined, corner: Corner, size: number): Feature | undefined {
  if (holes?.kind !== 'holes' || holes.place.pattern !== 'corners' || corner === 'sharp') return holes;
  const room = holeRoom(holes.d, holes.countersink);
  const need = corner === 'round' ? size - (size - room) / Math.SQRT2 : (size + Math.SQRT2 * room) / 2;
  if (holes.place.inset < need + 0.5) holes.place.inset = Math.ceil((need + 0.5) * 2) / 2;
  return holes;
}

/** New features for a part, with sizes picked the way its family picks them. Each may still break a rule. */
function newFeatures(tree: Tree, rng: Rng): Feature[] {
  const b = tree.body;
  const has = (kind: FeatureKind, face?: string) => tree.features.some((f) => f.kind === kind && (!face || ('face' in f && f.face === face)));
  const out: (Feature | undefined)[] = [];
  switch (b.kind) {
    case 'plate': {
      if (!has('holes') && !has('bosses')) out.push(clearCorner(screwHoles(rng, 'top', plate.patterns, b.width, b.depth, b.thickness, plate.countersink), b.corner, b.cornerSize));
      if (!has('slots')) {
        const width = rng.pick([3, 3.5, 4, 4.5, 5, 6]);
        const along = rng.pick(['u', 'v'] as const);
        const length = fit(rng, width + 5, (along === 'u' ? b.width : b.depth) * 0.45);
        if (length !== undefined) out.push({ kind: 'slots', face: 'top', count: 1, length, width, spacing: 0, along });
      }
      if (!has('pocket') && b.thickness >= 3) {
        out.push({
          kind: 'pocket',
          face: 'top',
          width: rng.size(Math.round(b.width * 0.2), Math.round(b.width * 0.45)),
          length: rng.size(Math.round(b.depth * 0.2), Math.round(b.depth * 0.45)),
          depth: rng.size(1, b.thickness - 1.6, 0.5),
        });
      }
      if (!has('ribs')) {
        const t = rng.size(2, 4, 0.5);
        out.push({ kind: 'ribs', count: rng.int(1, 3), thickness: t, height: rng.size(3, Math.min(15, 6 * t), 0.5) });
      }
      if (!has('lip') && !has('notch')) {
        out.push({ kind: 'lip', height: rng.size(2, 6, 0.5), wall: rng.size(1.6, 3, 0.2) });
        const width = fit(rng, 8, b.width / 2 - b.cornerSize - 4);
        if (width !== undefined) out.push({ kind: 'notch', width, depth: rng.size(3, Math.max(3, Math.floor(b.depth / 4))) });
      }
      break;
    }
    case 'box': {
      if (!has('holes') && !has('dividers')) {
        const holes = screwHoles(rng, 'floor', tray.patterns, b.width - 2 * b.wall, b.depth - 2 * b.wall, b.floor, 0.2, 5);
        if (holes?.kind === 'holes' && holes.place.pattern === 'corners') holes.place.inset += Math.ceil(b.cornerSize);
        out.push(holes);
        const most = Math.floor((b.depth - b.wall) / (Math.max(b.cornerSize + b.wall, b.wall + 8) + 1e-9)) - 1;
        if (most >= 1) out.push({ kind: 'dividers', count: rng.int(1, Math.min(3, most)) });
      }
      if (!has('tabs')) {
        const hole = rng.pick([3, 3.5, 4, 4.5, 5]);
        const width = fit(rng, hole + 5, Math.min(24, b.depth - 2 * b.cornerSize - 4));
        if (width !== undefined) {
          const length = rng.size(Math.ceil(width / 2 + hole / 2 + 2.5), Math.ceil(width / 2 + hole / 2 + 10));
          out.push({ kind: 'tabs', length, width, thickness: rng.size(2, Math.min(5, b.height), 0.5), hole });
        }
      }
      break;
    }
    case 'angle': {
      const t = b.thickness;
      if (!has('holes', 'base') && !has('slots')) {
        out.push(screwHoles(rng, 'base', bracket.patterns, b.width, b.base - t, t, bracket.countersink));
        const width = rng.pick([3, 3.5, 4, 4.5, 5]);
        const length = fit(rng, width + 5, (b.base - t) * 0.6);
        const two = b.width >= 40 && rng.chance(0.5);
        const spacing = two ? fit(rng, width + 6, b.width - width - 8) : 0;
        if (length !== undefined && spacing !== undefined) out.push({ kind: 'slots', face: 'base', count: two ? 2 : 1, length, width, spacing, along: 'v' });
      }
      if (!has('holes', 'upright')) out.push(screwHoles(rng, 'upright', bracket.patterns, b.width, b.height - t, t, bracket.countersink, 5));
      if (!has('gussets')) {
        const most = Math.min(b.base, b.height) - t - 2;
        // gussets stay below the screw holes, so a screw head never sits against one
        let below = most;
        for (const h of tree.features) if (h.kind === 'holes') below = Math.min(below, ((h.face === 'base' ? b.base : b.height) - t) / 2 - h.d - 1.5);
        const size = fit(rng, Math.max(6, Math.min(most * 0.4, below)), Math.min(most * 0.8, below));
        if (size !== undefined) out.push({ kind: 'gussets', count: rng.int(1, 2), size, thickness: rng.size(2, t, 0.5) });
      }
      break;
    }
    case 'channel': {
      const inner = b.width - 2 * b.wall;
      if (!has('holes') && !has('slots')) {
        out.push(screwHoles(rng, 'floor', channel.patterns, b.length, inner, b.floor, channel.countersink, 5));
        const width = rng.pick([3, 4, 5]);
        const two = rng.chance(0.6);
        const length = fit(rng, width + 3, inner - 4);
        const spacing = two ? fit(rng, width + 6, b.length * 0.7) : 0;
        if (length !== undefined && spacing !== undefined) out.push({ kind: 'slots', face: 'floor', count: two ? 2 : 1, length, width, spacing, along: 'v' });
      }
      if (!has('lips')) {
        const width = fit(rng, 1, Math.min(4, (inner - 6) / 2, (b.height - b.floor - 4) / 1.5), 0.5);
        if (width !== undefined) out.push({ kind: 'lips', width });
      }
      break;
    }
    case 'round': {
      if (!has('flange') && b.height >= 5) {
        const across = b.hex ? b.diameter / Math.cos(Math.PI / 6) : b.diameter;
        const holes = rng.pick(spacer.flangeHoles);
        const hole = rng.pick([3, 3.5, 4]);
        const least = holes ? across + 2 * (hole + 3.2) + 2 : across + 6;
        const d = fit(rng, least, least + 20);
        if (d !== undefined) out.push({ kind: 'flange', d, thickness: rng.size(2, Math.min(5, b.height - 2), 0.5), holes, hole: holes ? hole : 0 });
      }
      break;
    }
    case 'knob': {
      if (!has('grips')) {
        const d = fit(rng, 2, Math.min(5, b.diameter / 2 - b.shaft / 2 - 3.5), 0.5);
        if (d !== undefined) {
          const most = Math.floor((b.diameter * Math.PI) / (d + 2.5));
          if (most >= 8) out.push({ kind: 'grips', count: rng.int(Math.max(6, Math.floor(most / 2)), Math.min(30, most)), d });
        }
      }
      if (!has('flat')) {
        const depth = fit(rng, 0.5, b.shaft / 3 - 0.3, 0.5);
        if (depth !== undefined) out.push({ kind: 'flat', depth });
      }
      break;
    }
    case 'clip': {
      if (!has('holes') && b.length >= 10) {
        const d = rng.pick([3, 3.5, 4]);
        // room for the screw heads beside the ring
        const spacing = Math.ceil(b.cable + 2 * b.wall + 2 * d + 3) + rng.int(0, 6);
        out.push({ kind: 'holes', face: 'pad', d, countersink: false, place: { pattern: 'pair', spacing } });
      }
      break;
    }
    case 'hook':
      // a hook always has its screw holes, and nothing else goes on it
      break;
  }
  return out.filter((f): f is Feature => f !== undefined);
}

function addOps(side: Side, rng: Rng): AddOp[] {
  // two tries each, since picked sizes can still clash with what is already there
  return [...newFeatures(side.tree, rng), ...newFeatures(side.tree, rng)].map((feature) => ({ kind: 'add', feature }));
}

function removeOps(side: Side): RemoveOp[] {
  const b = side.tree.body;
  const fixings = side.tree.features.filter((f) => f.kind === 'holes' || f.kind === 'slots').length;
  return side.tree.features.flatMap((feature, index): RemoveOp[] => {
    // brackets and hooks are screwed on, so their last set of holes or slots stays
    if ((b.kind === 'angle' || b.kind === 'hook') && (feature.kind === 'holes' || feature.kind === 'slots') && fixings === 1) return [];
    return [{ kind: 'remove', index, feature }];
  });
}

/** The edits of one kind a part allows, in the order they should be tried. Any of them may still break a rule. */
export function candidates(kind: EditKind, side: Side, rng: Rng): EditOp[] {
  let ops: EditOp[];
  switch (kind) {
    case 'size':
    case 'hole_d':
    case 'move':
      ops = sizeOps(kind, side, rng);
      break;
    case 'count':
      ops = [...sizeOps('count', side, rng), ...shapeOps(side, rng)];
      break;
    case 'scale':
      ops = FACTORS.map((factor) => ({ kind: 'scale', factor }));
      break;
    case 'add':
      ops = addOps(side, rng);
      break;
    case 'remove':
      ops = removeOps(side);
      break;
  }
  return shuffle(rng, ops);
}

export function shuffle<T>(rng: Rng, items: T[]): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = rng.int(0, i);
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

/** How often each kind of edit is tried first. */
export const WEIGHTS: Record<EditKind, number> = { size: 0.3, hole_d: 0.1, move: 0.12, count: 0.13, scale: 0.05, add: 0.15, remove: 0.15 };

/** Every kind, in a weighted random order: a part that allows no edit of the first kind gets one of the next. */
export function kindOrder(rng: Rng): EditKind[] {
  const left = [...KINDS];
  const out: EditKind[] = [];
  while (left.length) {
    const total = left.reduce((sum, kind) => sum + WEIGHTS[kind], 0);
    let r = rng.next() * total;
    let i = 0;
    while (i < left.length - 1 && r >= WEIGHTS[left[i]!]) r -= WEIGHTS[left[i++]!];
    out.push(left.splice(i, 1)[0]!);
  }
  return out;
}
