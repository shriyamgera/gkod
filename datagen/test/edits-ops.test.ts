import { describe, expect, it } from 'vitest';
import { findFamily } from '../src/families/index.ts';
import { envOf } from '../src/model.ts';
import { modelOf } from '../src/part.ts';
import { rangesOf } from '../src/ranges.ts';
import { Rng } from '../src/rng.ts';
import type { Tree } from '../src/tree.ts';
import { validate } from '../src/validate.ts';
import { applyOp, candidates, inOrder, kindOrder, KINDS, type Side, sizeKind, stepsOf } from '../src/edits/ops.ts';

/** The families the edits know how to add features to: the day 6 set. */
const KNOWN = ['plate', 'bracket', 'channel', 'tray', 'spacer', 'hook', 'knob', 'clip'];

function sides(seed: number, perFamily: number): Side[] {
  const out: Side[] = [];
  const run = new Rng(seed);
  for (const id of KNOWN) {
    const family = findFamily(id)!;
    for (let i = 0, n = 0; n < perFamily; i++) {
      const tree = family.sample(run.child(i * 31 + id.length));
      if (validate(tree).length) continue;
      const model = modelOf(tree);
      const ranges = rangesOf(model);
      if ('reason' in ranges) continue;
      out.push({ tree, model, env: envOf(model), params: ranges.params });
      n++;
    }
  }
  return out;
}

describe('size kinds', () => {
  it('sorts each named size by the edit it takes', () => {
    expect(sizeKind('width')).toBe('size');
    expect(sizeKind('floor_thickness')).toBe('size');
    expect(sizeKind('hole_d')).toBe('hole_d');
    expect(sizeKind('upright_hole_d')).toBe('hole_d');
    expect(sizeKind('tab_hole_d')).toBe('hole_d');
    expect(sizeKind('bore_d')).toBe('hole_d');
    expect(sizeKind('shaft_d')).toBe('hole_d');
    expect(sizeKind('hole_spacing')).toBe('move');
    expect(sizeKind('base_hole_spacing_x')).toBe('move');
    expect(sizeKind('hole_inset')).toBe('move');
    expect(sizeKind('slot_spacing')).toBe('move');
    expect(sizeKind('hole_count')).toBe('count');
    expect(sizeKind('divider_count')).toBe('count');
    expect(sizeKind('snap')).toBeNull();
  });
});

describe('feature order', () => {
  it('is the order the families already list features in', () => {
    for (const side of sides(3, 40)) expect(inOrder(side.tree.features)).toEqual(side.tree.features);
  });
});

describe('apply', () => {
  const plate: Tree = {
    family: 'plate',
    body: { kind: 'plate', width: 80, depth: 50, thickness: 4, corner: 'sharp', cornerSize: 0 },
    features: [{ kind: 'holes', face: 'top', d: 4, countersink: false, place: { pattern: 'center' } }],
  };
  const model = modelOf(plate);

  it('changes one named size and leaves the tree it was given alone', () => {
    const before = structuredClone(plate);
    const out = applyOp(plate, model, { kind: 'size', name: 'width', mode: 'by', from: 80, to: 90 });
    expect(out.body).toEqual({ ...plate.body, width: 90 });
    expect(out.features).toEqual(plate.features);
    expect(applyOp(plate, model, { kind: 'hole_d', name: 'hole_d', mode: 'to', from: 4, to: 5 }).features[0]).toMatchObject({ d: 5 });
    expect(plate).toEqual(before);
  });

  it('scales every size but the counts', () => {
    const row: Tree = { ...plate, features: [{ kind: 'holes', face: 'top', d: 4.5, countersink: false, place: { pattern: 'row', count: 3, inset: 10 } }] };
    const out = applyOp(row, modelOf(row), { kind: 'scale', factor: 1.25 });
    expect(out.body).toMatchObject({ width: 100, depth: 62.5, thickness: 5 });
    expect(out.features[0]).toMatchObject({ d: 5.625, place: { pattern: 'row', count: 3, inset: 12.5 } });
  });

  it('adds a feature where the family would list it, and removes one', () => {
    const added = applyOp(plate, model, { kind: 'add', feature: { kind: 'dividers', count: 1 } });
    expect(added.features.map((f) => f.kind)).toEqual(['dividers', 'holes']);
    const ribbed = applyOp(plate, model, { kind: 'add', feature: { kind: 'ribs', count: 2, thickness: 2, height: 5 } });
    expect(ribbed.features.map((f) => f.kind)).toEqual(['holes', 'ribs']);
    expect(applyOp(ribbed, modelOf(ribbed), { kind: 'remove', index: 0, feature: ribbed.features[0]! }).features.map((f) => f.kind)).toEqual(['ribs']);
  });

  it('turns a centre hole into a pair and back', () => {
    const pair = applyOp(plate, model, { kind: 'count', name: null, feature: 'holes', face: 'top', from: 1, to: 2, spacing: 30 });
    expect(pair.features[0]).toMatchObject({ place: { pattern: 'pair', spacing: 30 } });
    const back = applyOp(pair, modelOf(pair), { kind: 'count', name: null, feature: 'holes', face: 'top', from: 2, to: 1 });
    expect(back).toEqual(plate);
  });
});

describe('candidates', () => {
  const all = sides(5, 25);

  it('offers every kind of edit across the families', () => {
    const rng = new Rng(9);
    const offered = new Set(all.flatMap((side) => KINDS.filter((kind) => candidates(kind, side, rng).length > 0)));
    expect([...offered].sort()).toEqual([...KINDS].sort());
  });

  it('keeps a changed size inside its slider range, and a count within two of where it was', () => {
    const rng = new Rng(11);
    for (const side of all) {
      for (const kind of ['size', 'hole_d', 'move', 'count'] as const) {
        for (const op of candidates(kind, side, rng)) {
          if (!('mode' in op)) continue;
          const p = side.params.find((x) => x.name === op.name)!;
          expect(op.from).toBe(p.value);
          expect(op.to).not.toBe(p.value);
          expect(stepsOf(p)).toContain(op.to);
          if (kind === 'count') expect(Math.abs(op.to - op.from)).toBeLessThanOrEqual(2);
          // one size moved inside its range always gives a valid part
          expect(validate(applyOp(side.tree, side.model, op))).toEqual([]);
        }
      }
    }
  });

  it('never removes the last fixing of a bracket or a hook', () => {
    for (const side of all.filter((s) => s.tree.body.kind === 'angle' || s.tree.body.kind === 'hook')) {
      for (const op of candidates('remove', side, new Rng(1))) {
        const left = applyOp(side.tree, side.model, op).features.filter((f) => f.kind === 'holes' || f.kind === 'slots');
        expect(left.length).toBeGreaterThan(0);
      }
    }
  });

  it('gives the same edits for the same seed', () => {
    const side = all[0]!;
    for (const kind of KINDS) expect(candidates(kind, side, new Rng(4))).toEqual(candidates(kind, side, new Rng(4)));
  });
});

describe('kind order', () => {
  it('lists every kind once, the same way for the same seed', () => {
    const order = kindOrder(new Rng(2));
    expect([...order].sort()).toEqual([...KINDS].sort());
    expect(kindOrder(new Rng(2))).toEqual(order);
    // size has the biggest weight, so it comes first most often
    const firsts = Array.from({ length: 2000 }, (_, i) => kindOrder(new Rng(i))[0]);
    const share = firsts.filter((k) => k === 'size').length / firsts.length;
    expect(share).toBeGreaterThan(0.25);
    expect(share).toBeLessThan(0.35);
  });
});
