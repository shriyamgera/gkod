// Puts an edit instruction together from short word lists and the edit's own numbers, and lists the facts it states.
// No whole instruction is written here: each one is assembled from a verb, the thing it changes and the amount.
import type { Axis } from '../model.ts';
import { prefixOf } from '../features.ts';
import { type Fact, featurePhrase, holeCount } from '../phrases.ts';
import type { Rng } from '../rng.ts';
import { evaluate } from '../scad.ts';
import type { BodyKind, Feature, Tree } from '../tree.ts';
import { article, cap, count, HOLE_NOUNS, mm, plural, type Style } from '../words.ts';
import type { EditOp, RemoveOp, ScaleOp, ShapeOp, Side, SizeOp } from './ops.ts';

/** A fact an instruction states. A scale is a ratio; everything else is as in a request. */
export type EditFact = Omit<Fact, 'unit'> & { unit: Fact['unit'] | 'ratio' };

export type Said = { text: string; facts: EditFact[] };

export type SayCtx = { a: Side; b: Side; s: Style; rng: Rng };

// ---- facts

/** The size each body's overall extent along an axis is named by, as the requests say it. */
const AXES: Partial<Record<BodyKind, Record<string, Axis | 'xy'>>> = {
  plate: { width: 'x', depth: 'y', thickness: 'z' },
  box: { width: 'x', depth: 'y', height: 'z' },
  angle: { width: 'x', base_length: 'y', height: 'z' },
  channel: { width: 'x', length: 'y', height: 'z' },
  round: { diameter: 'xy', across_flats: 'y', height: 'z' },
  hook: { width: 'z', reach: 'x', back_height: 'y' },
  knob: { diameter: 'xy', height: 'z' },
  clip: { base_width: 'x', length: 'z' },
};

/** A size fact on the new part; it names an axis only when the number is the part's real overall size along it. */
export function sizeFact(side: Side, name: string, value: number): EditFact {
  const fact: EditFact = { key: name, value, unit: name.endsWith('_count') ? 'count' : 'mm' };
  const axis = AXES[side.tree.body.kind]?.[name];
  const along = (a: Axis) => side.model.exact[a] && Math.abs(evaluate(side.model.extent[a], side.env) - value) < 1e-6;
  if (axis && (axis === 'xy' ? along('x') && along('y') : along(axis))) fact.axis = axis;
  return fact;
}

/** The new part's overall sizes that can be checked on its mesh. */
export function axisFacts(side: Side): EditFact[] {
  return Object.keys(AXES[side.tree.body.kind] ?? {})
    .filter((name) => side.env[name] !== undefined && side.model.sizes.some((s) => s.name === name))
    .map((name) => sizeFact(side, name, side.env[name]!))
    .filter((fact) => fact.axis);
}

// ---- words

type Dim = 'wide' | 'deep' | 'tall' | 'high' | 'thick' | 'long' | 'big' | 'across' | 'flats' | 'fb';

/** How a size grows and shrinks, and the word for its value ("80 mm wide"). */
const DIMS: Record<Dim, { more: string; less: string; adj: string }> = {
  wide: { more: 'wider', less: 'narrower', adj: 'wide' },
  deep: { more: 'deeper', less: 'shallower', adj: 'deep' },
  tall: { more: 'taller', less: 'shorter', adj: 'tall' },
  high: { more: 'higher', less: 'lower', adj: 'high' },
  thick: { more: 'thicker', less: 'thinner', adj: 'thick' },
  long: { more: 'longer', less: 'shorter', adj: 'long' },
  big: { more: 'bigger', less: 'smaller', adj: '' },
  across: { more: 'wider', less: 'narrower', adj: 'across' },
  flats: { more: 'wider across the flats', less: 'narrower across the flats', adj: 'across the flats' },
  // a box's depth is said front to back, so it does not read as how deep it is inside
  fb: { more: 'longer front to back', less: 'shorter front to back', adj: 'front to back' },
};

/** What an instruction calls a size: null for the whole part ("make it wider"). */
type Thing = { the: string | null; dims: Dim[]; plural?: boolean };

const OPENERS = ['', '', '', '', 'please ', 'now ', 'can you '] as const;
const REMOVE = ['remove', 'remove', 'take out', 'get rid of', 'drop'] as const;
const ORDINALS = ['', 'first', 'second', 'third', 'fourth', 'fifth', 'sixth', 'seventh', 'eighth', 'ninth', 'tenth', 'eleventh', 'twelfth'];
/** A scale factor said in words, for the factors that have them. */
const TIMES: Partial<Record<number, string>> = { 2: 'twice', 1.5: '1.5 times', 0.75: 'three quarters of' };

/** Bracket sizes on one face carry its name: base_hole_d is the hole diameter in the base. */
function split(name: string, tree: Tree): { stem: string; where: string } {
  const m = tree.body.kind === 'angle' ? /^(base|upright)_((hole|slot)_.*)$/.exec(name) : null;
  return m ? { stem: m[2]!, where: ` in the ${m[1]}` } : { stem: name, where: '' };
}

function holeSet(tree: Tree, where: string): Extract<Feature, { kind: 'holes' }> | undefined {
  const face = where ? where.slice(8) : undefined;
  return tree.features.find((f): f is Extract<Feature, { kind: 'holes' }> => f.kind === 'holes' && (!face || f.face === face));
}

function many(tree: Tree, kind: Feature['kind']): boolean {
  const f = tree.features.find((x) => x.kind === kind);
  return !f || !('count' in f) || f.count !== 1;
}

function thingOf(name: string, tree: Tree, rng: Rng): Thing | null {
  const b = tree.body;
  const { stem, where } = split(name, tree);
  const holes = holeSet(tree, where);
  const holesMany = !holes || holeCount(holes.place) !== 1;
  const the = (noun: string, more: boolean) => `the ${more ? `${noun}s` : noun}`;
  switch (stem) {
    case 'width':
      return { the: null, dims: ['wide'] };
    case 'depth':
      return { the: null, dims: [b.kind === 'box' ? 'fb' : 'deep'] };
    case 'height':
      if (b.kind === 'angle') return { the: 'the upright', dims: ['tall'] };
      return { the: null, dims: b.kind === 'round' ? ['tall', 'long'] : ['tall', 'high'] };
    case 'thickness':
      return { the: null, dims: ['thick'] };
    case 'length':
      return { the: null, dims: ['long'] };
    case 'diameter':
      return { the: null, dims: ['across'] };
    case 'across_flats':
      return { the: null, dims: ['flats'] };
    case 'wall':
      return { the: 'the walls', dims: ['thick'], plural: true };
    case 'floor_thickness':
      return { the: 'the floor', dims: ['thick'] };
    case 'corner_r':
      return { the: 'the corner radius', dims: ['big'] };
    case 'chamfer':
      return { the: b.kind === 'knob' ? 'the edge chamfer' : 'the corner chamfer', dims: ['big'] };
    case 'base_length':
      return { the: 'the base leg', dims: ['long'] };
    case 'back_height':
      return { the: 'the back plate', dims: ['tall'] };
    case 'reach':
      return { the: 'the reach', dims: ['long'] };
    case 'tip_height':
      return { the: 'the tip', dims: ['tall'] };
    case 'shaft_d':
      return { the: 'the shaft hole', dims: ['big'] };
    case 'shaft_depth':
      return { the: 'the shaft hole', dims: ['deep'] };
    case 'bore_d':
      return { the: 'the hole', dims: ['big'] };
    case 'ring_wall':
      return { the: 'the ring', dims: ['thick'] };
    case 'base_width':
      return { the: 'the base', dims: ['wide'] };
    case 'base_thickness':
      return { the: 'the base', dims: ['thick'] };
    case 'hole_d':
      return { the: `${the(rng.pick(HOLE_NOUNS), holesMany)}${where}`, dims: ['big'], plural: holesMany };
    case 'slot_length':
      return { the: `${the('slot', many(tree, 'slots'))}${where}`, dims: ['long'], plural: many(tree, 'slots') };
    case 'slot_width':
      return { the: `${the('slot', many(tree, 'slots'))}${where}`, dims: ['wide'], plural: many(tree, 'slots') };
    case 'pocket_width':
      return { the: 'the pocket', dims: ['wide'] };
    case 'pocket_length':
      return { the: 'the pocket', dims: ['fb'] };
    case 'pocket_depth':
      return { the: 'the pocket', dims: ['deep'] };
    case 'rib_thickness':
      return { the: the('rib', many(tree, 'ribs')), dims: ['thick'], plural: many(tree, 'ribs') };
    case 'rib_height':
      return { the: the('rib', many(tree, 'ribs')), dims: ['tall'], plural: many(tree, 'ribs') };
    case 'boss_d':
      return { the: 'the standoffs', dims: ['wide'], plural: true };
    case 'boss_height':
      return { the: 'the standoffs', dims: ['tall'], plural: true };
    case 'boss_hole_d':
      return { the: rng.pick(['the standoff holes', 'the holes in the standoffs']), dims: ['big'], plural: true };
    case 'lip_height':
      return { the: 'the rim', dims: ['high'] };
    case 'lip_wall':
      return { the: 'the rim', dims: ['thick'] };
    case 'notch_width':
      return { the: 'the notch', dims: ['wide'] };
    case 'notch_depth':
      return { the: 'the notch', dims: ['deep'] };
    case 'tab_length':
      return { the: 'the tabs', dims: ['long'], plural: true };
    case 'tab_width':
      return { the: 'the tabs', dims: ['wide'], plural: true };
    case 'tab_thickness':
      return { the: 'the tabs', dims: ['thick'], plural: true };
    case 'tab_hole_d':
      return { the: rng.pick(['the tab holes', 'the holes in the tabs']), dims: ['big'], plural: true };
    case 'gusset_size':
      return { the: the('gusset', many(tree, 'gussets')), dims: ['big'], plural: many(tree, 'gussets') };
    case 'gusset_thickness':
      return { the: the('gusset', many(tree, 'gussets')), dims: ['thick'], plural: many(tree, 'gussets') };
    case 'flange_d':
      return { the: 'the flange', dims: ['across', 'wide'] };
    case 'flange_thickness':
      return { the: 'the flange', dims: ['thick'] };
    case 'flange_hole_d':
      return { the: rng.pick(['the flange holes', 'the holes in the flange']), dims: ['big'], plural: true };
    case 'lip_width':
      return { the: 'the lips', dims: ['wide'], plural: true };
    case 'grip_d':
      return { the: 'the grip notches', dims: ['big'], plural: true };
    case 'flat_depth':
      return { the: 'the flat on the shaft hole', dims: ['deep'] };
  }
  return null;
}

/** The size's caption, as words inside a sentence, or null when it reads badly there (it has a comma). */
function captionOf(side: Side, name: string): string | null {
  const caption = side.params.find((p) => p.name === name)?.caption.replace(/ \(mm\)$/, '');
  if (!caption || caption.includes(',')) return null;
  return caption.charAt(0).toLowerCase() + caption.slice(1);
}

// ---- one sentence per kind of edit

function resize(op: SizeOp, ctx: SayCtx): string {
  const { rng, s } = ctx;
  const thing = thingOf(op.name, ctx.a.tree, rng);
  const caption = captionOf(ctx.a, op.name);
  const subject = thing?.the ?? 'it';
  // plain words first; the caption's words and the size's name as written in the code come up less often
  const plain: string[] = [];
  const named: string[] = [];
  if (op.name === 'cable_d') {
    // a clip is sized by what it holds
    const what = op.to >= 12 ? rng.pick(['pipe', 'tube']) : 'cable';
    const value = mm(s, op.to);
    if (op.mode === 'by') plain.push(`make it fit ${article(what)} ${what} ${mm(s, Math.abs(op.to - op.from))} ${op.to > op.from ? 'thicker' : 'thinner'}`);
    else plain.push(`make it fit ${article(value)} ${value} ${what}`, `make it for ${article(value)} ${value} ${what} instead`);
  }
  if (op.mode === 'by') {
    const amount = mm(s, Math.abs(op.to - op.from));
    const up = op.to > op.from;
    for (const d of thing?.dims ?? []) plain.push(`make ${subject} ${amount} ${up ? DIMS[d].more : DIMS[d].less}`);
    if (caption) named.push(`${up ? 'increase' : rng.pick(['reduce', 'decrease'])} the ${caption} by ${amount}`, up ? `add ${amount} to the ${caption}` : `take ${amount} off the ${caption}`);
    named.push(`${up ? 'increase' : 'reduce'} ${op.name} by ${amount}`);
  } else {
    const value = mm(s, op.to);
    for (const d of thing?.dims ?? []) {
      if (DIMS[d].adj) plain.push(`make ${subject} ${value} ${DIMS[d].adj}`);
      else if (thing?.the) plain.push(`make ${subject} ${value}`);
    }
    if (op.kind === 'hole_d' && thing?.the) {
      const bare = thing.the.replace(/^the /, '');
      plain.push(thing.plural ? `use ${value} ${bare} instead` : `use ${article(value)} ${value} ${bare} instead`);
    }
    if (caption) named.push(`change the ${caption} to ${value}`, `set the ${caption} to ${value}`);
    named.push(`set ${op.name} to ${value}`);
  }
  return rng.chance(0.7) && plain.length ? rng.pick(plain) : rng.pick([...plain, ...named]);
}

function move(op: SizeOp, ctx: SayCtx): string {
  const { rng, s } = ctx;
  const { stem, where } = split(op.name, ctx.a.tree);
  const caption = captionOf(ctx.a, op.name);
  const what = `${stem.startsWith('boss') ? 'the standoffs' : stem.startsWith('slot') ? 'the slots' : 'the holes'}${where}`;
  const axis = stem.endsWith('_x') ? ' left to right' : stem.endsWith('_y') ? ' front to back' : '';
  const up = op.to > op.from;
  const forms: string[] = [];
  if (stem.includes('inset')) {
    const edges = holeSet(ctx.a.tree, where)?.place.pattern === 'row' ? 'ends' : 'edges';
    if (op.mode === 'by') {
      const amount = mm(s, Math.abs(op.to - op.from));
      forms.push(`move ${what} ${amount} ${up ? `further in from the ${edges}` : `closer to the ${edges}`}`);
    } else forms.push(`put ${what} ${mm(s, op.to)} in from the ${edges}`, `move ${what} to ${mm(s, op.to)} from the ${edges}`);
  } else if (op.mode === 'by') {
    const amount = mm(s, Math.abs(op.to - op.from));
    const way = up ? 'further apart' : 'closer together';
    forms.push(`move ${what} ${amount} ${way}${axis}`, `space ${what} ${amount} ${way}${axis}`);
  } else forms.push(`space ${what} ${mm(s, op.to)} apart${axis}`, `put ${what} ${mm(s, op.to)} apart${axis}`);
  if (caption) forms.push(op.mode === 'by' ? `${up ? 'increase' : 'reduce'} the ${caption} by ${mm(s, Math.abs(op.to - op.from))}` : `change the ${caption} to ${mm(s, op.to)}`);
  return rng.pick(forms);
}

/** What a counted size counts, one and many. */
function counted(name: string, tree: Tree, rng: Rng): { one: string; many: string } {
  const { stem, where } = split(name, tree);
  switch (stem) {
    case 'hole_count': {
      const noun = rng.pick(HOLE_NOUNS);
      return { one: `${noun}${where}`, many: `${noun}s${where}` };
    }
    case 'flange_hole_count':
      return { one: 'hole in the flange', many: 'holes in the flange' };
    case 'grip_count':
      return { one: 'grip notch', many: 'grip notches' };
    default: {
      const noun = stem.replace(/_count$/, '');
      return { one: noun, many: `${noun}s` };
    }
  }
}

function recount(op: SizeOp, ctx: SayCtx): Said {
  const { rng, s } = ctx;
  const [n, m] = [op.from, op.to];
  const { one, many: lots } = counted(op.name, ctx.a.tree, rng);
  const say = (k: number) => `${count(s, k)} ${k === 1 ? one : lots}`;
  const fact = sizeFact(ctx.b, op.name, m);
  if (op.name === 'divider_count' && rng.chance(0.4)) {
    const text = rng.chance(0.5) ? `split it into ${count(s, m + 1)} compartments` : `make it ${count(s, m + 1)} compartments instead of ${count(s, n + 1)}`;
    return { text, facts: [{ key: 'compartment_count', value: m + 1, unit: 'count' }] };
  }
  const forms = [`use ${say(m)} instead of ${count(s, n)}`, `change the number of ${lots} to ${count(s, m)}`];
  if (m === n + 1) forms.push(...(m < ORDINALS.length ? [`add a ${ORDINALS[m]} ${one}`] : []), `add one more ${one}`, `add another ${one}`);
  if (m === n + 2) forms.push(`add ${count(s, 2)} more ${lots}`);
  if (m === n - 1) forms.push(`remove one ${one}`, `use one fewer ${one}`);
  if (m === n - 2) forms.push(`remove ${count(s, 2)} ${lots}`);
  return { text: rng.pick(forms), facts: [fact] };
}

function reshape(op: ShapeOp, ctx: SayCtx): Said {
  const { rng, s } = ctx;
  if (op.feature === 'gussets') {
    const { one } = counted('gusset_count', ctx.a.tree, rng);
    const forms = op.to === 2 ? [`add a ${ORDINALS[2]} ${one}`, `use ${count(s, 2)} ${one}s instead of one`] : [`use one ${one} in the middle instead of ${count(s, 2)}`];
    return { text: rng.pick(forms), facts: [{ key: 'gusset_count', value: op.to, unit: 'count' }] };
  }
  const { p } = prefixOf(ctx.a.tree.body, op.face!);
  const where = p ? ` in the ${op.face}` : '';
  if (op.to === 2) {
    const apart = `${mm(s, op.spacing!)} apart`;
    const forms = [`use ${count(s, 2)} holes ${apart} instead of one${where}`, `replace the hole${where} with ${count(s, 2)} holes ${apart}`];
    return { text: rng.pick(forms), facts: [{ key: `${p}hole_count`, value: 2, unit: 'count' }, sizeFact(ctx.b, `${p}hole_spacing`, op.spacing!)] };
  }
  const middle = p ? `in the middle of the ${op.face}` : 'in the middle';
  const forms = [`use one hole ${middle} instead of ${count(s, 2)}`, `replace the ${count(s, 2)} holes${where} with one ${middle}`];
  return { text: rng.pick(forms), facts: [{ key: `${p}hole_count`, value: 1, unit: 'count' }] };
}

function scale(op: ScaleOp, ctx: SayCtx): Said {
  const { rng } = ctx;
  const k = op.factor;
  const what = rng.pick(['it', 'the whole part', 'everything']);
  const pct = Math.round(Math.abs(k - 1) * 100);
  const forms =
    k > 1
      ? [`make ${what} ${pct}% bigger`, `scale ${what} up by ${pct}%`, `scale ${what} to ${Math.round(k * 100)}%`]
      : [`make ${what} ${pct}% smaller`, `scale ${what} down by ${pct}%`, `scale ${what} to ${Math.round(k * 100)}%`];
  if (k === 2) forms.push(`make ${what} ${TIMES[k]} as big`);
  if (TIMES[k]) forms.push(`make ${what} ${TIMES[k]} the size`);
  return { text: rng.pick(forms), facts: [{ key: 'scale', value: k, unit: 'ratio' }, ...axisFacts(ctx.b)] };
}

function add(feature: Feature, ctx: SayCtx): Said {
  const { rng, s } = ctx;
  if (feature.kind === 'flat') {
    const depth = mm(s, feature.depth);
    const text = rng.pick([`add ${article(depth)} ${depth} flat to the shaft hole`, `make the shaft hole D-shaped, with ${article(depth)} ${depth} flat`]);
    return { text, facts: [{ key: 'shaft_flat', value: 1, unit: 'flag' }, sizeFact(ctx.b, 'flat_depth', feature.depth)] };
  }
  const phrase = featurePhrase({ rng, s, tree: ctx.b.tree, model: ctx.b.model, env: ctx.b.env }, feature);
  if (!phrase) throw new Error(`No words for an added ${feature.kind}.`);
  const verbs = phrase.text.endsWith('compartments') ? ['split it into', 'give it'] : ['add', 'add', 'give it'];
  return { text: `${rng.pick(verbs)} ${phrase.text}`, facts: phrase.facts };
}

/** What an instruction calls a feature, and the fact that says it is gone. */
function removed(op: RemoveOp, tree: Tree, rng: Rng): { the: string; fact: EditFact } {
  const f = op.feature;
  const gone = (key: string, unit: 'count' | 'flag' = 'count'): EditFact => ({ key, value: 0, unit });
  switch (f.kind) {
    case 'holes': {
      const { p } = prefixOf(tree.body, f.face);
      const noun = plural(rng.pick(HOLE_NOUNS), holeCount(f.place));
      return { the: `the ${noun}${p ? ` in the ${f.face}` : ''}`, fact: gone(`${p}hole_count`) };
    }
    case 'slots': {
      const { p } = prefixOf(tree.body, f.face);
      return { the: `the ${plural('slot', f.count)}${p ? ` in the ${f.face}` : ''}`, fact: gone(`${p}slot_count`) };
    }
    case 'pocket':
      return { the: 'the pocket', fact: gone('pocket', 'flag') };
    case 'ribs':
      return { the: `the ${plural('rib', f.count)}`, fact: gone('rib_count') };
    case 'bosses':
      return { the: 'the standoffs', fact: gone('boss_count') };
    case 'lip':
      return { the: rng.pick(['the rim', 'the raised edge']), fact: gone('rim', 'flag') };
    case 'notch':
      return { the: 'the notch', fact: gone('notch', 'flag') };
    case 'tabs':
      return { the: rng.pick(['the tabs', 'the mounting tabs']), fact: gone('tab_count') };
    case 'dividers':
      return { the: `the ${plural('divider', f.count)}`, fact: gone('divider_count') };
    case 'gussets':
      return { the: `the ${plural('gusset', f.count)}`, fact: gone('gusset_count') };
    case 'flange':
      return { the: 'the flange', fact: gone('flange', 'flag') };
    case 'lips':
      return { the: 'the lips', fact: gone('lips', 'flag') };
    case 'grips':
      return { the: 'the grip notches', fact: gone('grip_count') };
    case 'flat':
      return { the: 'the flat on the shaft hole', fact: gone('shaft_flat', 'flag') };
    default: {
      // a feature from a newer family: named by its kind
      const kind = (f as Feature).kind;
      return { the: `the ${kind}`, fact: gone(kind, 'flag') };
    }
  }
}

function remove(op: RemoveOp, ctx: SayCtx): Said {
  const { rng } = ctx;
  const { the, fact } = removed(op, ctx.a.tree, rng);
  const forms = [`${rng.pick(REMOVE)} ${the}`, `${rng.pick(REMOVE)} ${the}`, `make it without ${the}`];
  if (op.feature.kind === 'flat') forms.push(`make ${thingOf('shaft_d', ctx.a.tree, rng)!.the} round`);
  return { text: rng.pick(forms), facts: [fact] };
}

/** The instruction for an edit and the facts it states, assembled from the word lists with the edit's numbers. */
export function instruct(op: EditOp, ctx: SayCtx): Said {
  let said: Said;
  switch (op.kind) {
    case 'scale':
      said = scale(op, ctx);
      break;
    case 'add':
      said = add(op.feature, ctx);
      break;
    case 'remove':
      said = remove(op, ctx);
      break;
    default:
      if (op.name === null) said = reshape(op, ctx);
      else if (op.kind === 'count') said = recount(op, ctx);
      else said = { text: op.kind === 'move' ? move(op, ctx) : resize(op, ctx), facts: [sizeFact(ctx.b, op.name, op.to)] };
  }
  const { rng } = ctx;
  const opener = rng.pick(OPENERS);
  let text = `${opener}${said.text}`;
  if (opener === 'can you ') text += '?';
  else if (rng.chance(0.15)) text += '.';
  return { text: rng.chance(0.5) ? cap(text) : text, facts: said.facts };
}

