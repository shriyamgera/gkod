import { describe, expect, it } from 'vitest';
import { FAMILIES, findFamily, sampleTree } from '../src/families/index.ts';
import { Rng } from '../src/rng.ts';
import { validate } from '../src/validate.ts';

describe('families', () => {
  it('has eight families with unique ids', () => {
    const ids = FAMILIES.map((family) => family.id);
    expect(ids).toEqual(['plate', 'bracket', 'channel', 'tray', 'spacer', 'hook', 'knob', 'clip']);
    expect(findFamily('hook')?.id).toBe('hook');
    expect(findFamily('nope')).toBeUndefined();
  });

  it('gives the same tree for the same seed and index', () => {
    const a = new Rng(11);
    const b = new Rng(11);
    for (let i = 0; i < 50; i++) expect(sampleTree(a.child(i))).toEqual(sampleTree(b.child(i)));
    expect(JSON.stringify(sampleTree(a.child(537)))).toBe(JSON.stringify(sampleTree(new Rng(11).child(537))));
  });

  it.each(FAMILIES.map((family) => [family.id, family] as const))('%s makes valid trees almost every time', (_, family) => {
    const rng = new Rng(2026);
    let bad = 0;
    const kinds = new Set<string>();
    for (let i = 0; i < 300; i++) {
      const tree = family.sample(rng.child(i));
      expect(tree.family).toBe(family.id);
      tree.features.forEach((feature) => kinds.add(feature.kind));
      if (validate(tree).length) bad++;
    }
    expect(bad).toBeLessThan(300 * 0.08);
    expect(kinds.size).toBeGreaterThan(0);
  });

  it('picks every family over a run', () => {
    const run = new Rng(1);
    const seen = new Set(Array.from({ length: 200 }, (_, i) => sampleTree(run.child(i)).family));
    expect(seen.size).toBe(FAMILIES.length);
  });
});
