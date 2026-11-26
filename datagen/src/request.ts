// Puts a request together from the word lists and phrase pieces, with the tree's numbers, and lists the facts it states.
import { envOf, type Model } from './model.ts';
import { bodyPhrases, type Fact, featurePhrase, type Phrase, type Say } from './phrases.ts';
import type { Rng } from './rng.ts';
import type { Tree } from './tree.ts';
import { article, ASKS, cap, count, list, NOUNS, styleOf } from './words.ts';

export type Request = { request: string; title: string; facts: Fact[] };

function nounsOf(tree: Tree): readonly string[] {
  const b = tree.body;
  if (b.kind === 'round' && b.hex) return NOUNS.hexSpacer!;
  if (b.kind === 'clip' && b.cable >= 12) return NOUNS.pipeClip!;
  return NOUNS[tree.family] ?? [tree.family];
}

const COMPACT = /^[\d.]+( x | by |x)[\d.]+/;

function shuffle<T>(rng: Rng, items: T[]): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = rng.int(0, i);
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

/** A short title for the part, also the first line of its code. */
function titleOf(noun: string, tree: Tree, say: Say): string {
  const holes = tree.features.find((f) => f.kind === 'holes');
  if (!holes || holes.kind !== 'holes') return cap(noun);
  const n = holes.place.pattern === 'center' ? 1 : holes.place.pattern === 'pair' ? 2 : holes.place.pattern === 'row' ? holes.place.count : 4;
  const title = `${cap(noun)} with ${n === 1 ? 'a hole' : `${count(say.s, n)} holes`}`;
  return title.length <= 40 ? title : cap(noun);
}

export function compose(tree: Tree, model: Model, rng: Rng): Request {
  const say: Say = { rng, s: styleOf(rng), tree, model, env: envOf(model) };
  const noun = rng.pick(nounsOf(tree));
  const body = bodyPhrases(say);
  const features = tree.features.map((feature) => featurePhrase(say, feature));
  const all: Phrase[] = [...body, ...features];
  const sizes = all.filter((p) => !p.noun).map((p) => p.text);
  const things = all.filter((p) => p.noun).map((p) => p.text);
  const ordered = rng.chance(0.3) ? shuffle(rng, sizes) : sizes;
  const withPart = things.length ? `with ${list(things)}` : '';
  const ask = rng.pick(ASKS);
  let text: string;
  const form = rng.int(0, 3);
  if (form === 0 || ordered.length === 0) {
    // "Mounting plate, 80 x 50 mm, 4 mm thick, with four holes in the corners"
    text = [cap(noun), ...ordered, withPart].filter(Boolean).join(', ');
  } else if (form === 1 && COMPACT.test(ordered[0]!)) {
    // "An 80 x 50 mm mounting plate, 4 mm thick, with ..."
    const lead = `${article(ordered[0]!)} ${ordered[0]} ${noun}`;
    text = [`${ask}${ask ? lead : cap(lead)}`, ...ordered.slice(1), withPart].filter(Boolean).join(', ');
  } else if (form === 2 && things.length) {
    // "Make a mounting plate with four holes in the corners, 80 mm wide and 50 mm deep"
    const lead = `${article(noun)} ${noun} ${withPart}`;
    text = `${ask}${ask ? lead : cap(lead)}, ${list(ordered)}`;
  } else {
    // "I need a mounting plate, 80 mm wide and 50 mm deep, with ..."
    const lead = `${article(noun)} ${noun}`;
    text = [`${ask}${ask ? lead : cap(lead)}`, list(ordered), withPart].filter(Boolean).join(', ');
  }
  const facts = all.flatMap((p) => p.facts);
  return { request: text, title: titleOf(noun, tree, say), facts };
}
