// Puts a request together from the word lists and phrase pieces, with the tree's numbers, and lists the facts it states.
import { envOf, type Model } from './model.ts';
import { bodyPhrases, type Fact, featurePhrase, holeCount, type Phrase, type Say } from './phrases.ts';
import type { Rng } from './rng.ts';
import type { Feature, Tree } from './tree.ts';
import { article, ASKS, cap, count, list, NOUNS, styleOf } from './words.ts';

export type Request = { request: string; title: string; facts: Fact[] };

function nounsOf(tree: Tree): readonly string[] {
  const b = tree.body;
  if (b.kind === 'round' && b.hex) return NOUNS.hexSpacer!;
  if (b.kind === 'clip' && b.cable >= 12) return NOUNS.pipeClip!;
  // a plate with nothing to fix it by is not called a mounting plate
  if (b.kind === 'plate' && !tree.features.some((f) => ['holes', 'slots', 'bosses'].includes(f.kind))) {
    return NOUNS.plate!.filter((noun) => noun !== 'mounting plate');
  }
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

/** A short title for the part, also the first line of its code. It counts the holes of every face. */
function titleOf(noun: string, tree: Tree, say: Say): string {
  const sets = tree.features.filter((f): f is Extract<Feature, { kind: 'holes' }> => f.kind === 'holes');
  // tabs and standoffs have holes of their own, so a count of the plain holes would be short
  if (!sets.length || tree.features.some((f) => f.kind === 'tabs' || f.kind === 'bosses')) return cap(noun);
  const n = sets.reduce((sum, f) => sum + holeCount(f.place), 0);
  const title = `${cap(noun)} with ${n === 1 ? 'a hole' : `${count(say.s, n)} holes`}`;
  return title.length <= 40 ? title : cap(noun);
}

export function compose(tree: Tree, model: Model, rng: Rng): Request {
  const say: Say = { rng, s: styleOf(rng), tree, model, env: envOf(model) };
  const noun = rng.pick(nounsOf(tree));
  const body = bodyPhrases(say);
  const features = tree.features.map((feature) => featurePhrase(say, feature)).filter((p): p is Phrase => p !== null);
  const all: Phrase[] = [...body, ...features];
  // what the part is for goes right after its name: "wire clip for a 6 mm cable"
  const named = [noun, ...all.filter((p) => p.lead).map((p) => p.text)].join(' ');
  const sizes = all.filter((p) => !p.noun && !p.lead).map((p) => p.text);
  const things = all.filter((p) => p.noun).map((p) => p.text);
  const ordered = rng.chance(0.3) ? shuffle(rng, sizes) : sizes;
  const withPart = things.length ? `with ${list(things)}` : '';
  const ask = rng.pick(ASKS);
  let text: string;
  const form = rng.int(0, 3);
  if (form === 0 || ordered.length === 0) {
    // "Mounting plate, 80 x 50 mm, 4 mm thick, with four holes in the corners"
    text = [cap(named), ...ordered, withPart].filter(Boolean).join(', ');
  } else if (form === 1 && COMPACT.test(ordered[0]!)) {
    // "An 80 x 50 mm mounting plate, 4 mm thick, with ..."
    const lead = `${article(ordered[0]!)} ${ordered[0]} ${named}`;
    text = [`${ask}${ask ? lead : cap(lead)}`, ...ordered.slice(1), withPart].filter(Boolean).join(', ');
  } else if (form === 2 && things.length) {
    // "Make a mounting plate with four holes in the corners, 80 mm wide and 50 mm deep"; a comma after what the part
    // is for, so "a clip for a 6 mm cable, with two holes" does not give the holes to the cable
    const lead = `${article(noun)} ${named}${named === noun ? '' : ','} ${withPart}`;
    text = `${ask}${ask ? lead : cap(lead)}, ${list(ordered)}`;
  } else {
    // "I need a mounting plate, 80 mm wide and 50 mm deep, with ..."
    const lead = `${article(noun)} ${named}`;
    text = [`${ask}${ask ? lead : cap(lead)}`, list(ordered), withPart].filter(Boolean).join(', ');
  }
  const facts = all.flatMap((p) => p.facts);
  return { request: text, title: titleOf(noun, tree, say), facts };
}
