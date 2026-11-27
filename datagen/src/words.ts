// Short word lists and phrase pieces that requests are put together from. No whole request is written here.
import type { Rng } from './rng.ts';
import { num } from './scad.ts';

/** What each family is called. */
export const NOUNS: Record<string, readonly string[]> = {
  plate: ['mounting plate', 'flat plate', 'base plate', 'backing plate', 'plate'],
  bracket: ['L bracket', 'angle bracket', 'corner bracket', 'L-shaped bracket', 'shelf bracket'],
  channel: ['cable channel', 'U channel', 'cable tray', 'wire channel', 'U-shaped channel'],
  tray: ['tray', 'open box', 'storage tray', 'organizer tray', 'box'],
  spacer: ['spacer', 'round spacer', 'standoff', 'bushing'],
  hexSpacer: ['hex spacer', 'hex standoff', 'hexagonal spacer'],
  hook: ['wall hook', 'hook', 'coat hook', 'J hook'],
  knob: ['knob', 'control knob', 'round knob', 'dial knob'],
  clip: ['cable clip', 'wire clip', 'cable holder'],
  pipeClip: ['pipe clip', 'tube clip', 'pipe holder'],
  washer: ['washer', 'flat washer', 'spacer washer', 'shim washer'],
  shelf: ['wall shelf', 'small shelf', 'shelf', 'small wall shelf', 'display shelf'],
  tool_holder: ['tool holder', 'screwdriver holder', 'tool rack', 'wall tool holder', 'screwdriver rack'],
  slot_plate: ['slotted mounting plate', 'adjustable mounting plate', 'slotted plate', 'slotted base plate'],
  divider: ['bin divider', 'drawer divider', 'divider plate', 'organizer divider'],
  enclosure: ['enclosure base', 'electronics enclosure base', 'project box base', 'PCB enclosure', 'case bottom'],
  coaster: ['coaster', 'drink coaster', 'cup coaster', 'mug coaster'],
  foot: ['furniture foot', 'bumper foot', 'round foot', 'foot', 'device foot'],
  grommet: ['desk grommet', 'cable grommet', 'grommet', 'desk cable grommet'],
  cup: ['pen holder', 'pen cup', 'pencil cup', 'desk cup', 'brush holder'],
  comb: ['cable comb', 'cable organizer', 'wire comb', 'cable guide'],
  saddle: ['pipe saddle', 'pipe clamp', 'saddle clamp', 'pipe strap', 'conduit clamp'],
  handle: ['drawer pull', 'drawer handle', 'cabinet handle', 'pull handle', 'bar handle'],
  corner_plate: ['corner plate', 'flat corner brace', 'L plate', 'flat L bracket', 'corner brace'],
  bit_holder: ['bit holder', 'hex bit holder', 'bit organizer', 'screwdriver bit holder'],
  battery_holder: ['battery holder', 'battery organizer', 'battery storage block', 'battery rack'],
};

export const ASKS = ['', '', '', 'Make ', 'I need ', 'Design ', 'Create ', 'Print '] as const;

export const NUMBER_WORDS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve'];

/** How one request writes its numbers: the same way all through, as a person would. */
export type Style = { mm: ' mm' | 'mm'; words: boolean; by: ' x ' | ' by ' | 'x' };

export function styleOf(rng: Rng): Style {
  return {
    mm: rng.chance(0.7) ? ' mm' : 'mm',
    words: rng.chance(0.6),
    by: rng.pick([' x ', ' x ', ' by ', 'x'] as const),
  };
}

export const mm = (s: Style, value: number) => `${num(value)}${s.mm}`;

export const count = (s: Style, n: number) => (s.words && n < NUMBER_WORDS.length ? NUMBER_WORDS[n]! : String(n));

/** "80 x 50 mm", "80 by 50 mm" or "80x50mm". */
export const pair = (s: Style, a: number, b: number) => `${num(a)}${s.by}${num(b)}${s.mm}`;

export const triple = (s: Style, a: number, b: number, c: number) => `${num(a)}${s.by}${num(b)}${s.by}${num(c)}${s.mm}`;

/** "a" or "an" for the word that follows, numbers included (an 80 mm, an 11 mm, an L bracket, a U channel). */
export function article(next: string): string {
  if (/^(8|11|18)(\D|$)|^8\d|^[aeioAEIO]|^u[a-rt-z]|^L\b|^L-/.test(next)) return 'an';
  return 'a';
}

export const plural = (word: string, n: number) => (n === 1 ? word : `${word}s`);

export const cap = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

/** Joins phrases as a person lists them: "a, b and c". */
export function list(items: string[]): string {
  if (items.length <= 1) return items.join('');
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

export const HOLE_NOUNS = ['hole', 'screw hole', 'mounting hole'] as const;

export const PLACES = {
  corners: ['in the corners', 'near the corners', 'at the corners'],
  center: ['in the middle', 'in the centre', 'at the centre'],
  row: ['in a row', 'evenly spaced in a line', 'in a line'],
} as const;
