import { describe, expect, it } from 'vitest';
import { sampleTree } from '../src/families/index.ts';
import { envOf } from '../src/model.ts';
import { modelOf } from '../src/part.ts';
import type { Fact } from '../src/phrases.ts';
import { compose } from '../src/request.ts';
import { Rng } from '../src/rng.ts';
import { num } from '../src/scad.ts';
import type { Feature, Tree } from '../src/tree.ts';
import { validate } from '../src/validate.ts';
import { article, NUMBER_WORDS } from '../src/words.ts';

function samples(seed: number, count: number) {
  const run = new Rng(seed);
  const out: { tree: Tree; rng: Rng }[] = [];
  for (let i = 0; out.length < count; i++) {
    const part = run.child(i);
    const tree = sampleTree(part);
    if (validate(tree).length === 0) out.push({ tree, rng: part.child(2) });
  }
  return out;
}

const holeCount = (f: Extract<Feature, { kind: 'holes' }>) =>
  ({ center: 1, pair: 2, corners: 4, grid: 4, row: f.place.pattern === 'row' ? f.place.count : 0 })[f.place.pattern];

/** What the tree itself says a fact should be, worked out here without the request code. */
function truth(tree: Tree, fact: Fact): number | undefined {
  const model = modelOf(tree);
  const env = envOf(model);
  if (fact.unit === 'mm') return model.sizes.find((s) => s.name === fact.key)?.value;
  const find = (kind: Feature['kind'], face?: string) => tree.features.find((f) => f.kind === kind && (!face || ('face' in f && f.face === face)));
  const face = fact.key.startsWith('base_') ? 'base' : fact.key.startsWith('upright_') ? 'upright' : undefined;
  const key = face ? fact.key.slice(face.length + 1) : fact.key;
  const holes = find('holes', face) as Extract<Feature, { kind: 'holes' }> | undefined;
  const b = tree.body;
  switch (key) {
    case 'hole_count': return holes && holeCount(holes);
    case 'countersunk': return holes?.countersink ? 1 : undefined;
    case 'slot_count': return (find('slots', face) as { count: number } | undefined)?.count;
    case 'rib_count': return env.rib_count;
    case 'boss_count': return find('bosses') ? 4 : undefined;
    case 'tab_count': return find('tabs') ? 2 : undefined;
    case 'divider_count': return env.divider_count;
    case 'compartment_count': return env.divider_count === undefined ? undefined : env.divider_count + 1;
    case 'gusset_count': return (find('gussets') as { count: number } | undefined)?.count;
    case 'flange_hole_count': return env.flange_hole_count;
    case 'grip_count': return env.grip_count;
    case 'rounded_corners': return 'corner' in b && b.corner === 'round' ? 1 : undefined;
    case 'chamfered_corners': return 'corner' in b && b.corner === 'chamfer' ? 1 : undefined;
    case 'lips': return find('lips') ? 1 : undefined;
    case 'grip': return find('grips') ? 1 : undefined;
    case 'shaft_flat': return find('flat') ? 1 : undefined;
    case 'notch': return find('notch') ? 1 : undefined;
  }
  return undefined;
}

describe('compose', () => {
  const parts = samples(5, 1000);

  it('states only facts the tree has', () => {
    for (const { tree, rng } of parts) {
      const { facts, request } = compose(tree, modelOf(tree), rng);
      expect(facts.length, request).toBeGreaterThan(0);
      expect(new Set(facts.map((f) => f.key)).size, request).toBe(facts.length);
      for (const fact of facts) expect(truth(tree, fact), `${fact.key} in "${request}"`).toBe(fact.value);
    }
  });

  it('writes every stated number into the text', () => {
    for (const { tree, rng } of parts) {
      const { facts, request } = compose(tree, modelOf(tree), rng);
      for (const fact of facts) {
        if (fact.unit === 'mm') expect(request, fact.key).toMatch(new RegExp(`(^|[^\\d.])${num(fact.value).replace('.', '\\.')}( ?mm| x| by|x)`));
        if (fact.unit === 'count') {
          const said = [String(fact.value), NUMBER_WORDS[fact.value]!, ...(fact.value === 1 ? ['a', 'one'] : [])];
          expect(said.some((word) => new RegExp(`\\b${word}\\b`).test(request)), `${fact.key} in "${request}"`).toBe(true);
        }
      }
    }
  });

  it('names an axis only for sizes that are the overall size of the part', () => {
    for (const { tree, rng } of parts) {
      const model = modelOf(tree);
      const { facts } = compose(tree, model, rng);
      for (const fact of facts.filter((f) => f.axis)) {
        expect(fact.unit).toBe('mm');
        const axes = fact.axis === 'xy' ? (['x', 'y'] as const) : [fact.axis!];
        for (const axis of axes) expect(model.exact[axis]).toBe(true);
      }
    }
  });

  it('gives the same request for the same seed', () => {
    for (const { tree } of parts.slice(0, 30)) {
      const a = compose(tree, modelOf(tree), new Rng(99));
      const b = compose(structuredClone(tree), modelOf(tree), new Rng(99));
      expect(a).toEqual(b);
    }
  });

  it('varies the wording and keeps a short title', () => {
    // the wording rules are checked on more parts than the facts, from a second seed too
    const texts = [...parts, ...samples(1, 3000)].map(({ tree, rng }) => compose(tree, modelOf(tree), rng));
    expect(new Set(texts.slice(0, parts.length).map((t) => t.request)).size).toBe(parts.length);
    expect(texts.some((t) => / mm\b/.test(t.request))).toBe(true);
    expect(texts.some((t) => /\dmm\b/.test(t.request))).toBe(true);
    expect(texts.some((t) => /^(Make|I need|Design|Create|Print) /.test(t.request))).toBe(true);
    for (const t of texts) {
      expect(t.title.length).toBeLessThanOrEqual(40);
      expect(t.title).toMatch(/^[A-Z]/);
      expect(t.request).not.toMatch(/\b(a [aeio8]|an [bcdfgjkmnpqrstvwxz2-79])/i);
      expect(t.request).not.toMatch(/\b\d+ \d/);
      // what the part is for follows its name, never a list, and what follows it belongs to the part
      expect(t.request).not.toMatch(/(,| and) (for|that fits) /);
      expect(t.request).not.toMatch(/\b(for|fits) (an? )?[\d.]+ ?mm [\w-]+ with\b/);
      // an open box's depth is never called deep, which would read as its height
      if (/\b(tray|box)\b/.test(t.request)) expect(t.request).not.toMatch(/\bdeep\b/);
      // the shaft hole and its flat are said once
      expect(t.request.match(/shaft/g)?.length ?? 0).toBeLessThanOrEqual(1);
    }
  });

  it('gives the real number of holes in the title', () => {
    let counted = 0;
    for (const { tree, rng } of parts) {
      const { title } = compose(tree, modelOf(tree), rng);
      const said = /with (a|\w+) holes?$/.exec(title)?.[1];
      if (said === undefined) continue;
      counted++;
      const n = said === 'a' ? 1 : NUMBER_WORDS.includes(said) ? NUMBER_WORDS.indexOf(said) : Number(said);
      const sets = tree.features.filter((f) => f.kind === 'holes') as Extract<Feature, { kind: 'holes' }>[];
      expect(n, `${title}: ${JSON.stringify(tree.features)}`).toBe(sets.reduce((sum, f) => sum + holeCount(f), 0));
      expect(tree.features.some((f) => f.kind === 'tabs' || f.kind === 'bosses'), title).toBe(false);
    }
    expect(counted).toBeGreaterThan(200);
    // a bracket with holes in both legs counts all of them
    const bracket: Tree = {
      family: 'bracket',
      body: { kind: 'angle', width: 40, base: 50, height: 60, thickness: 4 },
      features: [
        { kind: 'holes', face: 'base', d: 4, countersink: false, place: { pattern: 'center' } },
        { kind: 'holes', face: 'upright', d: 4, countersink: false, place: { pattern: 'pair', spacing: 20 } },
      ],
    };
    expect(compose(bracket, modelOf(bracket), new Rng(1)).title).toMatch(/ with (3|three) holes$/);
  });

  it('picks a or an by sound', () => {
    expect(article('80 mm plate')).toBe('an');
    expect(article('11 mm hole')).toBe('an');
    expect(article('L bracket')).toBe('an');
    expect(article('U channel')).toBe('a');
    expect(article('U-shaped channel')).toBe('a');
    expect(article('open box')).toBe('an');
    expect(article('4 mm hole')).toBe('a');
    expect(article('1 mm rim')).toBe('a');
  });
});
