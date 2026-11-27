// Phrase pieces for each body and feature, filled with the tree's own numbers. Each piece carries the facts it states.
import type { Axis, Model } from './model.ts';
import { prefixOf } from './features.ts';
import type { Rng } from './rng.ts';
import { evaluate, type Env } from './scad.ts';
import type { Feature, Place, Tree } from './tree.ts';
import { article, count, HOLE_NOUNS, mm, pair, PLACES, plural, type Style, triple } from './words.ts';

/** One thing a request states, to be checked on the made part later. */
export type Fact = { key: string; value: number; unit: 'mm' | 'count' | 'flag'; axis?: Axis | 'xy' };

/**
 * noun: a thing the part has ("2 mm walls"), said after "with". lead: what the part is for ("for a 6 mm cable"), said
 * right after the part's name. Otherwise a size said in the list ("80 mm wide").
 */
export type Phrase = { text: string; facts: Fact[]; noun?: boolean; lead?: boolean };

export type Say = { rng: Rng; s: Style; tree: Tree; model: Model; env: Env };

const flag = (key: string): Fact => ({ key, value: 1, unit: 'flag' });
const many = (key: string, value: number): Fact => ({ key, value, unit: 'count' });

/** A size fact; it names an axis only when the number is the part's real overall size along it. */
function sized(say: Say, key: string, value: number, axis?: Axis | 'xy'): Fact {
  const fact: Fact = { key, value, unit: 'mm' };
  const along = (a: Axis) => say.model.exact[a] && Math.abs(evaluate(say.model.extent[a], say.env) - value) < 1e-6;
  if (axis === 'xy' ? along('x') && along('y') : axis && along(axis)) fact.axis = axis;
  return fact;
}

const ph = (text: string, ...facts: Fact[]): Phrase => ({ text, facts });
const np = (text: string, ...facts: Fact[]): Phrase => ({ text, facts, noun: true });
const lp = (text: string, ...facts: Fact[]): Phrase => ({ text, facts, lead: true });
/** "a 4 mm bore" or "an 8 mm bore". */
const a = (text: string) => `${article(text)} ${text}`;

/** Clearance holes and the metric screw each one is for. */
const SCREW_FOR: Record<number, number> = { 3.5: 3, 4.5: 4, 5.5: 5, 6.5: 6, 9: 8 };

// ---- the body: its outer sizes

function outer(say: Say, w: number, d: number, h: number | null, words: [string, string, string]): Phrase[] {
  const { rng, s } = say;
  const facts = [sized(say, 'width', w, 'x'), sized(say, 'depth', d, 'y')];
  const keyH = words[2] === 'thick' ? 'thickness' : 'height';
  if (h !== null && rng.chance(0.5)) {
    return [ph(triple(s, w, d, h), ...facts, sized(say, keyH, h, 'z'))];
  }
  const out = rng.chance(0.5)
    ? [ph(pair(s, w, d), ...facts)]
    : [ph(`${mm(s, w)} ${words[0]}`, facts[0]!), ph(`${mm(s, d)} ${words[1]}`, facts[1]!)];
  if (h !== null && rng.chance(0.75)) out.push(ph(`${mm(s, h)} ${words[2]}`, sized(say, keyH, h, 'z')));
  return out;
}

/** Body phrases for families that reuse another family's body but are said differently. */
function presetPhrases(say: Say): Phrase[] | null {
  const { rng, s, tree } = say;
  const b = tree.body;
  if (b.kind === 'angle' && (tree.family === 'shelf' || tree.family === 'tool_holder')) {
    // the base is the shelf and the upright is the back against the wall
    const out = [
      tree.family === 'shelf' ? ph(`${mm(s, b.width)} wide`, sized(say, 'width', b.width, 'x')) : ph(`${mm(s, b.width)} long`, sized(say, 'width', b.width, 'x')),
      ph(`${mm(s, b.base)} deep`, sized(say, 'base_length', b.base, 'y')),
    ];
    if (rng.chance(0.7)) out.push(np(a(`${mm(s, b.height)} tall back`), sized(say, 'height', b.height, 'z')));
    if (rng.chance(0.6)) out.push(ph(`${mm(s, b.thickness)} thick`, sized(say, 'thickness', b.thickness)));
    return out;
  }
  if (b.kind === 'plate' && tree.family === 'divider') {
    // a divider stands up in use, so its sizes are said as a flat outline and a thickness, never as tall or deep
    const out = [ph(pair(s, b.width, b.depth), sized(say, 'width', b.width, 'x'), sized(say, 'depth', b.depth, 'y'))];
    out.push(ph(`${mm(s, b.thickness)} thick`, sized(say, 'thickness', b.thickness, 'z')));
    if (b.corner === 'round') out.push(np('rounded corners', flag('rounded_corners')));
    return out;
  }
  return null;
}

export function bodyPhrases(say: Say): Phrase[] {
  const { rng, s, tree } = say;
  const b = tree.body;
  const preset = presetPhrases(say);
  if (preset) return preset;
  switch (b.kind) {
    case 'plate': {
      const out = outer(say, b.width, b.depth, b.thickness, ['wide', 'deep', 'thick']);
      if (b.corner !== 'sharp') {
        const word = b.corner === 'round' ? 'rounded' : 'chamfered';
        const key = b.corner === 'round' ? 'corner_r' : 'chamfer';
        out.push(rng.chance(0.4) ? np(`${mm(s, b.cornerSize)} ${word} corners`, sized(say, key, b.cornerSize)) : np(`${word} corners`, flag(`${word}_corners`)));
      }
      return out;
    }
    case 'box': {
      // "deep" would read as how deep the box is inside, so its depth is said as front to back
      const out = outer(say, b.width, b.depth, b.height, ['wide', 'front to back', rng.pick(['tall', 'high'])]);
      if (rng.chance(0.5)) out.push(np(`${mm(s, b.wall)} walls`, sized(say, 'wall', b.wall)));
      if (rng.chance(0.25)) out.push(np(a(`${mm(s, b.floor)} floor`), sized(say, 'floor_thickness', b.floor)));
      if (b.corner !== 'sharp') out.push(np(`${b.corner === 'round' ? 'rounded' : 'chamfered'} corners`, flag(`${b.corner === 'round' ? 'rounded' : 'chamfered'}_corners`)));
      return out;
    }
    case 'angle': {
      const out = [ph(`${mm(s, b.width)} wide`, sized(say, 'width', b.width, 'x'))];
      if (rng.chance(0.5)) {
        out.push(np(a(`${mm(s, b.base)} base leg`), sized(say, 'base_length', b.base, 'y')), np(a(`${mm(s, b.height)} upright`), sized(say, 'height', b.height, 'z')));
      } else {
        out.push(np(`legs of ${mm(s, b.base)} (base) and ${mm(s, b.height)} (upright)`, sized(say, 'base_length', b.base, 'y'), sized(say, 'height', b.height, 'z')));
      }
      if (rng.chance(0.8)) out.push(ph(`${mm(s, b.thickness)} thick`, sized(say, 'thickness', b.thickness)));
      return out;
    }
    case 'channel': {
      const out = [
        ph(`${mm(s, b.length)} long`, sized(say, 'length', b.length, 'y')),
        ph(`${mm(s, b.width)} wide`, sized(say, 'width', b.width, 'x')),
        ph(`${mm(s, b.height)} ${rng.pick(['tall', 'high'])}`, sized(say, 'height', b.height, 'z')),
      ];
      if (rng.chance(0.5)) out.push(np(`${mm(s, b.wall)} walls`, sized(say, 'wall', b.wall)));
      return out;
    }
    case 'round': {
      const across = b.hex
        ? ph(rng.pick([`${mm(s, b.diameter)} across flats`, `${mm(s, b.diameter)} across the flats`]), sized(say, 'across_flats', b.diameter, 'y'))
        : ph(rng.pick([`${mm(s, b.diameter)} across`, `${mm(s, b.diameter)} outer diameter`, `${mm(s, b.diameter)} wide`]), sized(say, 'diameter', b.diameter, 'xy'));
      return [
        across,
        ph(`${mm(s, b.height)} ${tree.family === 'washer' ? 'thick' : rng.pick(['tall', 'long', 'high'])}`, sized(say, 'height', b.height, 'z')),
        // a screw is named only by its metric size, with the clearance hole it needs
        SCREW_FOR[b.bore] !== undefined && rng.chance(0.4)
          ? np(`${a(`${mm(s, b.bore)} hole`)} for an M${SCREW_FOR[b.bore]} screw`, sized(say, 'bore_d', b.bore))
          : np(rng.pick([a(`${mm(s, b.bore)} hole through it`), a(`${mm(s, b.bore)} bore`)]), sized(say, 'bore_d', b.bore)),
      ];
    }
    case 'hook': {
      const out = [
        ph(`${mm(s, b.width)} wide`, sized(say, 'width', b.width, 'z')),
        rng.chance(0.5) ? ph(`reaching out ${mm(s, b.reach)}`, sized(say, 'reach', b.reach, 'x')) : np(a(`${mm(s, b.reach)} reach`), sized(say, 'reach', b.reach, 'x')),
      ];
      if (rng.chance(0.7)) out.push(np(a(`${mm(s, b.plate)} tall back plate`), sized(say, 'back_height', b.plate, 'y')));
      if (rng.chance(0.4)) out.push(np(a(`${mm(s, b.tip)} tall tip`), sized(say, 'tip_height', b.tip)));
      if (rng.chance(0.5)) out.push(ph(`${mm(s, b.thickness)} thick`, sized(say, 'thickness', b.thickness)));
      return out;
    }
    case 'knob': {
      const out = [
        ph(rng.pick([`${mm(s, b.diameter)} across`, `${mm(s, b.diameter)} in diameter`]), sized(say, 'diameter', b.diameter, 'xy')),
        ph(`${mm(s, b.height)} ${rng.pick(['tall', 'high'])}`, sized(say, 'height', b.height, 'z')),
      ];
      // a flat in the shaft hole is said with the hole itself
      const flat = tree.features.some((f) => f.kind === 'flat');
      const shaft = [sized(say, 'shaft_d', b.shaft), ...(flat ? [flag('shaft_flat')] : [])];
      const hole = flat ? 'D-shaped shaft hole' : 'shaft hole';
      if (rng.chance(0.4)) out.push(np(a(`${mm(s, b.shaft)} ${hole} ${mm(s, b.shaftDepth)} deep`), ...shaft, sized(say, 'shaft_depth', b.shaftDepth)));
      else if (rng.chance(0.5)) out.push(lp(`for ${a(`${mm(s, b.shaft)} ${flat ? 'D-shaft' : 'shaft'}`)}`, ...shaft));
      else out.push(np(flat && rng.chance(0.5) ? a(`${mm(s, b.shaft)} shaft hole with a flat`) : a(`${mm(s, b.shaft)} ${hole}`), ...shaft));
      return out;
    }
    case 'clip': {
      const out = [
        lp(
          b.cable >= 12
            ? rng.pick([`for ${a(`${mm(s, b.cable)} pipe`)}`, `that fits ${a(`${mm(s, b.cable)} tube`)}`])
            : rng.pick([`for ${a(`${mm(s, b.cable)} cable`)}`, `that fits ${a(`${mm(s, b.cable)} cable`)}`, `for ${mm(s, b.cable)} wire`]),
          sized(say, 'cable_d', b.cable),
        ),
        ph(`${mm(s, b.length)} long`, sized(say, 'length', b.length, 'z')),
      ];
      if (rng.chance(0.5)) out.push(np(a(`${mm(s, b.pad)} wide base`), sized(say, 'base_width', b.pad, 'x')));
      return out;
    }
    case 'disc':
      return [
        ph(rng.pick([`${mm(s, b.diameter)} across`, `${mm(s, b.diameter)} in diameter`, `${mm(s, b.diameter)} round`]), sized(say, 'diameter', b.diameter, 'xy')),
        ph(`${mm(s, b.thickness)} thick`, sized(say, 'thickness', b.thickness, 'z')),
      ];
    case 'saddle': {
      const out = [
        lp(
          rng.pick([`for ${a(`${mm(s, b.pipe)} pipe`)}`, `that fits ${a(`${mm(s, b.pipe)} pipe`)}`, `for ${mm(s, b.pipe)} pipe`, `for ${a(`${mm(s, b.pipe)} tube`)}`]),
          sized(say, 'pipe_d', b.pipe),
        ),
        ph(`${mm(s, b.width)} wide`, sized(say, 'width', b.width, 'z')),
      ];
      if (rng.chance(0.5)) out.push(ph(`${mm(s, b.thickness)} thick`, sized(say, 'thickness', b.thickness)));
      if (rng.chance(0.5)) out.push(np(rng.pick([`${mm(s, b.foot)} feet`, `feet ${mm(s, b.foot)} long`]), sized(say, 'foot_length', b.foot)));
      return out;
    }
    case 'handle': {
      const out: Phrase[] = [];
      const spacing = sized(say, 'hole_spacing', b.spacing);
      if (rng.chance(0.5)) out.push(lp(`for ${mm(s, b.spacing)} hole spacing`, spacing));
      else out.push(np(`screw holes ${mm(s, b.spacing)} apart`, spacing));
      if (rng.chance(0.7)) out.push(ph(`${mm(s, b.length)} long`, sized(say, 'length', b.length, 'x')));
      if (rng.chance(0.7)) out.push(ph(rng.pick([`${mm(s, b.height)} tall`, `${mm(s, b.height)} high`, `standing ${mm(s, b.height)} off the drawer`]), sized(say, 'height', b.height, 'y')));
      if (rng.chance(0.4)) out.push(ph(`${mm(s, b.width)} wide`, sized(say, 'width', b.width, 'z')));
      if (rng.chance(0.3)) out.push(np(a(`${mm(s, b.grip)} thick grip`), sized(say, 'grip', b.grip)));
      if (rng.chance(0.3)) out.push(np(`${mm(s, b.screw)} screw holes ${mm(s, b.screwDepth)} deep`, sized(say, 'screw_d', b.screw), sized(say, 'screw_depth', b.screwDepth)));
      return out;
    }
    case 'foot': {
      const out = [
        ph(rng.pick([`${mm(s, b.diameter)} across at the base`, `${mm(s, b.diameter)} wide at the base`, `${mm(s, b.diameter)} in diameter`]), sized(say, 'diameter', b.diameter, 'xy')),
        ph(`${mm(s, b.height)} ${rng.pick(['tall', 'high'])}`, sized(say, 'height', b.height, 'z')),
      ];
      if (b.top < b.diameter && rng.chance(0.7)) out.push(ph(`narrowing to ${mm(s, b.top)} at the top`, sized(say, 'top_d', b.top)));
      return out;
    }
    case 'sleeve': {
      const out = [
        lp(rng.pick([`for ${a(`${mm(s, b.diameter)} hole`)}`, `for ${a(`${mm(s, b.diameter)} desk hole`)}`, `that fits ${a(`${mm(s, b.diameter)} hole`)}`]), sized(say, 'diameter', b.diameter, 'xy')),
        ph(`${mm(s, b.height)} ${rng.pick(['tall', 'deep', 'long'])}`, sized(say, 'height', b.height, 'z')),
      ];
      if (rng.chance(0.4)) out.push(np(`${mm(s, b.wall)} walls`, sized(say, 'wall', b.wall)));
      return out;
    }
    case 'cup': {
      const out = [
        b.sides
          ? ph(`${mm(s, b.diameter)} across the corners`, sized(say, 'diameter', b.diameter, b.sides === 6 ? 'x' : 'xy'))
          : ph(rng.pick([`${mm(s, b.diameter)} across`, `${mm(s, b.diameter)} in diameter`, `${mm(s, b.diameter)} wide`]), sized(say, 'diameter', b.diameter, 'xy')),
        ph(`${mm(s, b.height)} ${rng.pick(['tall', 'high'])}`, sized(say, 'height', b.height, 'z')),
      ];
      if (b.sides) out.push(np(b.sides === 6 ? 'six flat sides' : 'eight flat sides', flag(b.sides === 6 ? 'hexagonal' : 'octagonal')));
      if (rng.chance(0.5)) out.push(np(`${mm(s, b.wall)} walls`, sized(say, 'wall', b.wall)));
      if (rng.chance(0.25)) out.push(np(a(`${mm(s, b.floor)} floor`), sized(say, 'floor_thickness', b.floor)));
      return out;
    }
    case 'comb': {
      const out = outer(say, b.width, b.depth, b.thickness, ['wide', 'front to back', 'thick']);
      const facts = [many('slot_count', b.slots), sized(say, 'slot_width', b.slot)];
      // "6 6 mm slots" reads badly, so a count in digits never sits right before the size
      if (rng.chance(0.4)) {
        out.push(np(`${count(s, b.slots)} cable slots ${mm(s, b.slot)} wide and ${mm(s, b.slotDepth)} deep`, ...facts, sized(say, 'slot_depth', b.slotDepth)));
      } else {
        out.push(np(s.words && rng.chance(0.5) ? `${count(s, b.slots)} ${mm(s, b.slot)} cable slots` : `${count(s, b.slots)} cable slots ${mm(s, b.slot)} wide`, ...facts));
      }
      return out;
    }
    case 'corner': {
      const t = ph(`${mm(s, b.thickness)} thick`, sized(say, 'thickness', b.thickness, 'z'));
      const len = sized(say, 'length', b.length, 'xy');
      if (rng.chance(0.5)) return [np(`arms ${mm(s, b.length)} long and ${mm(s, b.arm)} wide`, len, sized(say, 'arm_width', b.arm)), t];
      const out = [ph(`${mm(s, b.length)} on each side`, len), t];
      if (rng.chance(0.6)) out.push(np(`arms ${mm(s, b.arm)} wide`, sized(say, 'arm_width', b.arm)));
      return out;
    }
  }
}

// ---- features

/** How many holes a pattern makes. The request and the title both count with this. */
export const holeCount = (place: Place) => (place.pattern === 'center' ? 1 : place.pattern === 'pair' ? 2 : place.pattern === 'row' ? place.count : 4);

function holes(say: Say, f: Extract<Feature, { kind: 'holes' }>): Phrase {
  const { rng, s, tree } = say;
  const { p } = prefixOf(tree.body, f.face);
  const n = holeCount(f.place);
  const facts: Fact[] = [many(`${p}hole_count`, n)];
  // the holes in a tool holder's shelf are for tools, not screws
  const noun = plural(tree.family === 'tool_holder' && f.face === 'base' ? rng.pick(['hole', 'tool hole']) : rng.pick(HOLE_NOUNS), n);
  const sink = f.countersink ? 'countersunk ' : '';
  if (f.countersink) facts.push(flag(`${p}countersunk`));
  const giveD = rng.chance(0.75);
  if (giveD) facts.push(sized(say, `${p}hole_d`, f.d));
  const amount = n === 1 ? (f.countersink ? 'a' : rng.pick(['a', 'one'])) : count(s, n);
  // "2 4 mm holes" reads badly, so a count in digits never sits right before the size
  let text =
    giveD && (n === 1 || s.words) && rng.chance(0.5)
      ? n === 1
        ? a(`${mm(s, f.d)} ${sink}${noun}`)
        : `${amount} ${mm(s, f.d)} ${sink}${noun}`
      : `${amount} ${sink}${noun}${giveD ? ` of ${mm(s, f.d)}` : ''}`;
  const place = f.place;
  // a cup's holes are said to be in its bottom, which is enough for one in the middle
  if (place.pattern === 'corners' || (place.pattern === 'center' && !p && tree.family !== 'cup') || place.pattern === 'row') {
    if (rng.chance(0.8)) text += ` ${rng.pick(PLACES[place.pattern])}`;
  } else if (place.pattern === 'pair' && rng.chance(0.6)) {
    text += ` ${text.endsWith('mm') ? 'spaced ' : ''}${mm(s, place.spacing)} apart`;
    facts.push(sized(say, `${p}hole_spacing`, place.spacing));
  } else if (place.pattern === 'grid' && rng.chance(0.6)) {
    text += ` on ${a(`${pair(s, place.x, place.y)} pattern`)}`;
    facts.push(sized(say, `${p}hole_spacing_x`, place.x), sized(say, `${p}hole_spacing_y`, place.y));
  }
  if (p === 'arm1_' || p === 'arm2_') text += ' in the arm';
  else if (p) text += ` in the ${faceWord(tree.family, p)}`;
  else if (tree.family === 'cup') text += ' in the bottom';
  return np(text, ...facts);
}

/** What a face with holes is called in a request. */
function faceWord(family: string, p: string): string {
  if (family === 'shelf' || family === 'tool_holder') return p === 'base_' ? 'shelf' : 'back';
  return p === 'base_' ? 'base' : 'upright';
}

/** Holes on both arms of a corner plate, said once for the two arms. */
function cornerHoles(say: Say, f: Extract<Feature, { kind: 'holes' }>): Phrase | null {
  if (f.face !== 'arm1') return null;
  const one = holes(say, f);
  const text = one.text.replace(/ in the [\w ]+$/, ' in each arm');
  return np(text, ...one.facts, ...one.facts.map((fact) => ({ ...fact, key: fact.key.replace(/^arm1_/, 'arm2_') })));
}

/** The phrase for a feature, or null when the body's own phrase already says it. */
export function featurePhrase(say: Say, f: Feature): Phrase | null {
  const { rng, s } = say;
  switch (f.kind) {
    case 'holes':
      return say.tree.body.kind === 'corner' ? cornerHoles(say, f) : holes(say, f);
    case 'slots': {
      const { p } = prefixOf(say.tree.body, f.face);
      const facts = [many(`${p}slot_count`, f.count), sized(say, `${p}slot_length`, f.length)];
      const amount = f.count === 1 ? 'a' : count(s, f.count);
      if (rng.chance(0.5)) {
        facts.push(sized(say, `${p}slot_width`, f.width));
        const size = pair(s, f.length, f.width);
        // "2 20 x 4.5 mm slots" reads as 220, so a count in digits comes before the noun and the size after it
        const text = f.count === 1 ? a(`${size} slot`) : s.words ? `${amount} ${size} slots` : `${amount} slots of ${size}`;
        return np(`${text}${p ? ` in the ${p.slice(0, -1)}` : ''}`, ...facts);
      }
      return np(`${amount} ${plural('slot', f.count)} ${mm(s, f.length)} long${f.count > 1 ? ' each' : ''}${p ? ` in the ${p.slice(0, -1)}` : ''}`, ...facts);
    }
    case 'pocket':
      return np(
        a(`${pair(s, f.width, f.length)} pocket ${mm(s, f.depth)} deep in the top`),
        sized(say, 'pocket_width', f.width),
        sized(say, 'pocket_length', f.length),
        sized(say, 'pocket_depth', f.depth),
      );
    case 'ribs': {
      const ribs = `${count(s, f.count)} ${rng.pick(['stiffening ', 'reinforcing ', ''])}${plural('rib', f.count)}`;
      if (rng.chance(0.5)) return np(`${ribs} ${mm(s, f.height)} tall on top`, many('rib_count', f.count), sized(say, 'rib_height', f.height));
      return np(`${ribs} on top`, many('rib_count', f.count));
    }
    case 'bosses': {
      const facts = [many('boss_count', 4), sized(say, 'boss_height', f.height)];
      // "4 9 mm tall standoffs" reads badly, so a count in digits comes before the noun and its size after it
      let text = s.words ? `${count(s, 4)} ${mm(s, f.height)} tall standoffs` : `4 standoffs ${mm(s, f.height)} tall`;
      if (rng.chance(0.6)) {
        text += ` with ${mm(s, f.hole)} holes`;
        facts.push(sized(say, 'boss_hole_d', f.hole));
      }
      if (f.place.pattern === 'grid' && rng.chance(0.7)) {
        text += ` on ${a(`${pair(s, f.place.x, f.place.y)} pattern`)}`;
        facts.push(sized(say, 'boss_spacing_x', f.place.x), sized(say, 'boss_spacing_y', f.place.y));
      }
      return np(text, ...facts);
    }
    case 'lip':
      // "a 2 mm rim" would read as its width, so the height is said as a height
      return np(rng.pick([`a rim ${mm(s, f.height)} high around the edge`, `a raised edge ${mm(s, f.height)} high`]), sized(say, 'lip_height', f.height));
    case 'notch':
      if (say.tree.family === 'divider') {
        // a narrow notch is a slot for a crossing divider, a wide one is for a finger
        if (f.width <= 4) {
          return np(`a slot ${mm(s, f.width)} wide and ${mm(s, f.depth)} long in the top edge, to cross another divider`, sized(say, 'notch_width', f.width), sized(say, 'notch_depth', f.depth));
        }
        return rng.chance(0.5)
          ? np(a(`${mm(s, f.width)} wide finger notch in the top edge`), sized(say, 'notch_width', f.width))
          : np('a finger notch in the top edge', flag('notch'));
      }
      return rng.chance(0.5)
        ? np(a(`${mm(s, f.width)} wide notch in the front edge`), sized(say, 'notch_width', f.width))
        : np('a notch in the front edge', flag('notch'));
    case 'tabs': {
      const text = rng.pick(['two mounting tabs', 'two side tabs', 'two screw tabs']);
      if (rng.chance(0.5)) return np(`${text} with ${mm(s, f.hole)} holes`, many('tab_count', 2), sized(say, 'tab_hole_d', f.hole));
      return np(text, many('tab_count', 2));
    }
    case 'dividers':
      return rng.chance(0.5)
        ? np(`${count(s, f.count)} ${plural('divider', f.count)}`, many('divider_count', f.count))
        : np(`${count(s, f.count + 1)} compartments`, many('compartment_count', f.count + 1));
    case 'gussets':
      if (say.tree.family === 'shelf' || say.tree.family === 'tool_holder') {
        // a shelf hangs with its back below it, so its gussets are underneath; a tool holder's back rises from its shelf
        const where = say.tree.family === 'shelf' ? ['gussets underneath', 'support gussets', 'gussets at the ends'] : ['support gussets', 'gussets at the ends'];
        return np(`${count(s, f.count)} ${rng.pick(where)}`, many('gusset_count', f.count));
      }
      return np(f.count === 1 ? `a ${rng.pick(['gusset', 'reinforcing gusset'])}` : `${count(s, 2)} gussets`, many('gusset_count', f.count));
    case 'flange': {
      const facts = [sized(say, 'flange_d', f.d)];
      // a grommet's flange sits on the desk, so it is not said to be at the bottom
      let text = say.tree.family === 'grommet' ? a(`${mm(s, f.d)} ${rng.pick(['flange', 'flange that sits on the desk'])}`) : a(`${mm(s, f.d)} flange at the bottom`);
      if (f.holes > 0) {
        text += ` with ${count(s, f.holes)} screw holes`;
        facts.push(many('flange_hole_count', f.holes));
      }
      return np(text, ...facts);
    }
    case 'lips':
      return np(rng.pick(['lips along the top to keep the cables in', 'inward lips on both walls']), flag('lips'));
    case 'grips':
      return rng.chance(0.5) ? np(`${count(s, f.count)} grip notches around the edge`, many('grip_count', f.count)) : np('a notched grip', flag('grip'));
    case 'flat':
      return null;
    case 'slit':
      return np(rng.pick(['a slot from the hole to the edge', 'a slot so it slides on from the side']), flag('slotted'));
    case 'grooves':
      return rng.chance(0.5)
        ? np(`${count(s, f.count)} finger grooves under the bar`, many('groove_count', f.count))
        : np('finger grooves under the bar', flag('finger_grooves'));
    case 'sockets':
      return sockets(say, f);
  }
}

/** Sockets for hex bits or round cells: rows and columns, their size and depth. */
function sockets(say: Say, f: Extract<Feature, { kind: 'sockets' }>): Phrase {
  const { rng, s } = say;
  const facts: Fact[] = [many('column_count', f.columns)];
  // round sockets are for batteries, named by the cell they take
  const cell = f.hex ? '' : f.d < 13 ? 'AAA' : f.d < 17 ? 'AA' : f.d < 23 ? '18650' : 'C';
  const kind = f.hex ? 'hex sockets' : cell === '18650' ? 'round sockets' : `${cell} ${cell === 'C' ? 'cell' : 'battery'} sockets`;
  let text: string;
  if (f.rows === 1) {
    text = `a row of ${count(s, f.columns)} ${kind}`;
    facts.push(many('row_count', 1));
  } else {
    text = `${count(s, f.rows)} rows of ${count(s, f.columns)} ${kind}`;
    facts.push(many('row_count', f.rows));
  }
  if (rng.chance(0.75)) {
    text += f.hex ? ` ${mm(s, f.d)} across the flats` : ` ${mm(s, f.d)} across`;
    facts.push(sized(say, 'socket_d', f.d));
  }
  if (rng.chance(0.5)) {
    text += ` ${text.endsWith('flats') || text.endsWith('across') ? 'and ' : ''}${mm(s, f.depth)} deep`;
    facts.push(sized(say, 'socket_depth', f.depth));
  }
  if (rng.chance(0.3)) {
    text += ` spaced ${mm(s, f.pitch)} apart`;
    facts.push(sized(say, 'socket_pitch', f.pitch));
  }
  if (cell === '18650') text += ' for 18650 cells';
  return np(text, ...facts);
}
