// Phrase pieces for each body and feature, filled with the tree's own numbers. Each piece carries the facts it states.
import type { Axis, Model } from './model.ts';
import { prefixOf } from './features.ts';
import type { Rng } from './rng.ts';
import { evaluate, type Env } from './scad.ts';
import type { Feature, Tree } from './tree.ts';
import { article, count, HOLE_NOUNS, mm, pair, PLACES, plural, type Style, triple } from './words.ts';

/** One thing a request states, to be checked on the made part later. */
export type Fact = { key: string; value: number; unit: 'mm' | 'count' | 'flag'; axis?: Axis | 'xy' };

/** noun: a thing the part has ("2 mm walls"), said after "with"; otherwise a size said in the list ("80 mm wide"). */
export type Phrase = { text: string; facts: Fact[]; noun?: boolean };

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
/** "a 4 mm bore" or "an 8 mm bore". */
const a = (text: string) => `${article(text)} ${text}`;

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

export function bodyPhrases(say: Say): Phrase[] {
  const { rng, s, tree } = say;
  const b = tree.body;
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
      const out = outer(say, b.width, b.depth, b.height, ['wide', 'deep', rng.pick(['tall', 'high'])]);
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
        ph(`${mm(s, b.height)} ${rng.pick(['tall', 'long', 'high'])}`, sized(say, 'height', b.height, 'z')),
        rng.chance(0.4)
          ? ph(`for ${a(`${mm(s, b.bore)} screw`)}`, sized(say, 'bore_d', b.bore))
          : np(rng.pick([a(`${mm(s, b.bore)} hole through it`), a(`${mm(s, b.bore)} bore`)]), sized(say, 'bore_d', b.bore)),
      ];
    }
    case 'hook': {
      const out = [
        ph(`${mm(s, b.width)} wide`, sized(say, 'width', b.width, 'z')),
        rng.chance(0.5) ? ph(`reaching out ${mm(s, b.reach)}`, sized(say, 'reach', b.reach)) : np(a(`${mm(s, b.reach)} reach`), sized(say, 'reach', b.reach)),
      ];
      if (rng.chance(0.7)) out.push(np(a(`${mm(s, b.plate)} tall back plate`), sized(say, 'plate_height', b.plate, 'y')));
      if (rng.chance(0.4)) out.push(np(a(`${mm(s, b.tip)} tall tip`), sized(say, 'tip', b.tip)));
      if (rng.chance(0.5)) out.push(ph(`${mm(s, b.thickness)} thick`, sized(say, 'thickness', b.thickness)));
      return out;
    }
    case 'knob': {
      const out = [
        ph(rng.pick([`${mm(s, b.diameter)} across`, `${mm(s, b.diameter)} in diameter`]), sized(say, 'diameter', b.diameter, 'xy')),
        ph(`${mm(s, b.height)} ${rng.pick(['tall', 'high'])}`, sized(say, 'height', b.height, 'z')),
      ];
      const shaft = sized(say, 'shaft_d', b.shaft);
      if (rng.chance(0.4)) out.push(np(a(`${mm(s, b.shaft)} shaft hole ${mm(s, b.shaftDepth)} deep`), shaft, sized(say, 'shaft_depth', b.shaftDepth)));
      else out.push(rng.chance(0.5) ? ph(`for ${a(`${mm(s, b.shaft)} shaft`)}`, shaft) : np(a(`${mm(s, b.shaft)} shaft hole`), shaft));
      return out;
    }
    case 'clip': {
      const out = [
        ph(
          b.cable >= 12
            ? rng.pick([`for ${a(`${mm(s, b.cable)} pipe`)}`, `fits ${a(`${mm(s, b.cable)} tube`)}`])
            : rng.pick([`for ${a(`${mm(s, b.cable)} cable`)}`, `fits ${a(`${mm(s, b.cable)} cable`)}`, `for ${mm(s, b.cable)} wire`]),
          sized(say, 'cable_d', b.cable),
        ),
        ph(`${mm(s, b.length)} long`, sized(say, 'length', b.length, 'z')),
      ];
      if (rng.chance(0.5)) out.push(np(a(`${mm(s, b.pad)} wide base`), sized(say, 'pad_width', b.pad, 'x')));
      return out;
    }
  }
}

// ---- features

function holes(say: Say, f: Extract<Feature, { kind: 'holes' }>): Phrase {
  const { rng, s, tree } = say;
  const { p } = prefixOf(tree.body, f.face);
  const n = f.place.pattern === 'center' ? 1 : f.place.pattern === 'pair' ? 2 : f.place.pattern === 'row' ? f.place.count : 4;
  const facts: Fact[] = [many(`${p}hole_count`, n)];
  const noun = plural(rng.pick(HOLE_NOUNS), n);
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
  if (place.pattern === 'corners' || (place.pattern === 'center' && !p) || place.pattern === 'row') {
    if (rng.chance(0.8)) text += ` ${rng.pick(PLACES[place.pattern])}`;
  } else if (place.pattern === 'pair' && rng.chance(0.6)) {
    text += ` ${text.endsWith('mm') ? 'spaced ' : ''}${mm(s, place.spacing)} apart`;
    facts.push(sized(say, `${p}hole_spacing`, place.spacing));
  } else if (place.pattern === 'grid' && rng.chance(0.6)) {
    text += ` on a ${pair(s, place.x, place.y)} pattern`;
    facts.push(sized(say, `${p}hole_spacing_x`, place.x), sized(say, `${p}hole_spacing_y`, place.y));
  }
  if (p) text += ` in the ${p === 'base_' ? 'base' : 'upright'}`;
  return np(text, ...facts);
}

export function featurePhrase(say: Say, f: Feature): Phrase {
  const { rng, s } = say;
  switch (f.kind) {
    case 'holes':
      return holes(say, f);
    case 'slots': {
      const { p } = prefixOf(say.tree.body, f.face);
      const facts = [many(`${p}slot_count`, f.count), sized(say, `${p}slot_length`, f.length)];
      const amount = f.count === 1 ? 'a' : count(s, f.count);
      if (rng.chance(0.5)) {
        facts.push(sized(say, `${p}slot_width`, f.width));
        const both = `${pair(s, f.length, f.width)} ${plural('slot', f.count)}`;
        return np(`${f.count === 1 ? a(both) : `${amount} ${both}`}${p ? ` in the ${p.slice(0, -1)}` : ''}`, ...facts);
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
      const text = `${count(s, f.count)} ${rng.pick(['stiffening ', 'reinforcing ', ''])}${plural('rib', f.count)} on top`;
      if (rng.chance(0.5)) return np(`${text}, ${mm(s, f.height)} tall`, many('rib_count', f.count), sized(say, 'rib_height', f.height));
      return np(text, many('rib_count', f.count));
    }
    case 'bosses': {
      const facts = [many('boss_count', 4), sized(say, 'boss_height', f.height)];
      // "4 9 mm tall standoffs" reads badly, so a count in digits comes after the noun's size
      let text = s.words ? `${count(s, 4)} ${mm(s, f.height)} tall standoffs` : `4 standoffs, ${mm(s, f.height)} tall`;
      if (rng.chance(0.6)) {
        text += `${s.words ? '' : ','} with ${mm(s, f.hole)} holes`;
        facts.push(sized(say, 'boss_hole_d', f.hole));
      }
      if (f.place.pattern === 'grid' && rng.chance(0.7)) {
        text += `, ${pair(s, f.place.x, f.place.y)} apart`;
        facts.push(sized(say, 'boss_spacing_x', f.place.x), sized(say, 'boss_spacing_y', f.place.y));
      }
      return np(text, ...facts);
    }
    case 'lip':
      return np(rng.pick([a(`${mm(s, f.height)} rim around the edge`), `a raised edge ${mm(s, f.height)} high`]), sized(say, 'lip_height', f.height));
    case 'notch':
      return rng.chance(0.5)
        ? np(a(`${mm(s, f.width)} wide notch in the front edge`), sized(say, 'notch_width', f.width))
        : np('a notch in the front edge', flag('notch'));
    case 'tabs': {
      const text = rng.pick(['two mounting tabs', 'two tabs, one on each side', 'two screw tabs']);
      if (rng.chance(0.5)) return np(`${text} with ${mm(s, f.hole)} holes`, many('tab_count', 2), sized(say, 'tab_hole_d', f.hole));
      return np(text, many('tab_count', 2));
    }
    case 'dividers':
      return rng.chance(0.5)
        ? np(`${count(s, f.count)} ${plural('divider', f.count)}`, many('divider_count', f.count))
        : ph(`split into ${count(s, f.count + 1)} compartments`, many('compartment_count', f.count + 1));
    case 'gussets':
      return np(f.count === 1 ? `a ${rng.pick(['gusset', 'reinforcing gusset'])}` : `${count(s, 2)} gussets`, many('gusset_count', f.count));
    case 'flange': {
      const facts = [sized(say, 'flange_d', f.d)];
      let text = a(`${mm(s, f.d)} flange at the bottom`);
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
      return np(rng.pick(['a D-shaped shaft hole', 'a flat in the shaft hole']), flag('shaft_flat'));
  }
}
