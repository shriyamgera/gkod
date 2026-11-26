import { describe, expect, it } from 'vitest';
import { envOf } from '../src/model.ts';
import { modelOf } from '../src/part.ts';
import { rangesOf } from '../src/ranges.ts';
import type { Feature, Tree } from '../src/tree.ts';
import { check, gap, validate } from '../src/validate.ts';

const plate = (features: Feature[] = [], body: Partial<Extract<Tree['body'], { kind: 'plate' }>> = {}): Tree => ({
  family: 'test',
  body: { kind: 'plate', width: 80, depth: 50, thickness: 4, corner: 'round', cornerSize: 5, ...body },
  features,
});

const corners = (d: number, inset: number, countersink = false): Feature => ({
  kind: 'holes', face: 'top', d, countersink, place: { pattern: 'corners', inset },
});

describe('validate', () => {
  it('passes a sensible plate', () => {
    expect(validate(plate([corners(4, 8)]))).toEqual([]);
  });

  it('keeps holes inside their limits and away from the edges', () => {
    expect(validate(plate([corners(13, 12)]))).toContain('Hole diameter must be from 2 to 12.');
    expect(validate(plate([corners(4, 3)]))).toEqual(['A hole is too close to the edge.']);
    expect(validate(plate([corners(4, 5)], { cornerSize: 12 }))).toEqual(['A hole is too close to a rounded corner.']);
    expect(validate(plate([corners(4, 5)], { corner: 'chamfer', cornerSize: 8 }))).toEqual(['A hole is too close to a chamfered corner.']);
  });

  it('keeps holes apart and needs enough material for a countersink', () => {
    const pair: Feature = { kind: 'holes', face: 'top', d: 6, countersink: false, place: { pattern: 'pair', spacing: 7 } };
    expect(validate(plate([pair]))).toEqual(['Two holes are too close together.']);
    expect(validate(plate([corners(6, 10, true)], { thickness: 3.5 }))).toEqual([
      'The material is too thin for countersunk holes this size.',
    ]);
  });

  it('refuses walls thinner than 1.6 mm and parts over 200 mm', () => {
    const box: Tree = {
      family: 'test',
      body: { kind: 'box', width: 60, depth: 40, height: 20, wall: 1.2, floor: 2, corner: 'sharp', cornerSize: 0 },
      features: [],
    };
    expect(validate(box)).toEqual(['Wall thickness must be from 1.6 to 10.']);
    expect(validate(plate([], { width: 210 }))).toEqual(['Plate width must be from 10 to 200.', 'The part is bigger than 200 mm along x.']);
  });

  it('does not let a slot cut the body in two', () => {
    const slot: Feature = { kind: 'slots', face: 'top', count: 1, length: 79, width: 5, spacing: 0, along: 'u' };
    expect(validate(plate([slot]))).toEqual(['A slot is too close to the edge.']);
  });

  it('keeps ribs and standoffs clear of holes', () => {
    const ribs: Feature = { kind: 'ribs', count: 1, thickness: 3, height: 6 };
    expect(validate(plate([corners(4, 8), ribs]))).toEqual([]);
    expect(validate(plate([corners(4, 8), { ...ribs, count: 3 }]))).toEqual([]);
    expect(validate(plate([corners(4, 8), { ...ribs, count: 4 }]))).toEqual(['A hole and a rib are too close together.']);
    const bosses: Feature = { kind: 'bosses', d: 8, height: 6, hole: 3, place: { pattern: 'corners', inset: 8 } };
    expect(validate(plate([corners(4, 8), bosses]))).toEqual(['A hole and a standoff are too close together.']);
  });

  it('keeps ribs on the base and rims on the plate', () => {
    const ribs: Feature = { kind: 'ribs', count: 1, thickness: 3, height: 30 };
    expect(validate(plate([ribs]))).toEqual(['The ribs are too tall for their thickness.']);
    const lip: Feature = { kind: 'lip', height: 5, wall: 2 };
    expect(validate(plate([lip]))).toEqual([]);
    expect(validate(plate([{ ...lip, wall: 26 }]))).toContain('The rim leaves too little room inside.');
    expect(validate(plate([lip, { kind: 'notch', width: 20, depth: 10 }]))).toEqual(['A plate takes a rim or a notch, not both.']);
  });

  it('refuses features a body does not take', () => {
    const tree: Tree = { family: 'test', body: { kind: 'knob', diameter: 30, height: 15, shaft: 6, shaftDepth: 10, chamfer: 1 }, features: [corners(4, 8)] };
    expect(validate(tree)).toEqual(['A knob cannot have holes.', 'A knob has no top face.']);
    expect(validate(plate([corners(4, 8), corners(5, 10)]))).toContain('Only one set of holes goes on each face.');
  });

  it('checks the bracket legs and gussets', () => {
    const angle: Tree = {
      family: 'test',
      body: { kind: 'angle', width: 30, base: 40, height: 40, thickness: 4 },
      features: [{ kind: 'gussets', count: 2, size: 20, thickness: 3 }],
    };
    expect(validate(angle)).toEqual([]);
    expect(validate({ ...angle, features: [{ kind: 'gussets', count: 2, size: 38, thickness: 3 }] })).toEqual([
      'The gussets are longer than the base leg.',
      'The gussets are taller than the upright leg.',
    ]);
  });

  it('measures the room between shapes', () => {
    const at = (u: number, v: number, r: number) => ({ face: 'top', cut: true, what: 'hole', u, v, r });
    const box = { face: 'top', cut: false, what: 'rib', u0: 0, v0: 10, u1: 80, v1: 13 };
    expect(gap(at(0, 0, 1), at(5, 0, 1))).toBe(3);
    expect(gap(at(5, 5, 2), box)).toBe(3);
    expect(gap(at(5, 11, 2), box)).toBe(-2);
  });
});

describe('ranges', () => {
  it('gives every size a range that holds its value and passes the rules at both ends', () => {
    const tree = plate([corners(4, 8, true), { kind: 'ribs', count: 1, thickness: 3, height: 6 }]);
    const model = modelOf(tree);
    const result = rangesOf(model);
    if (!('params' in result)) throw new Error(result.reason);
    expect(result.params.map((p) => p.name)).toEqual([
      'width', 'depth', 'thickness', 'corner_r', 'hole_d', 'hole_inset', 'rib_count', 'rib_thickness', 'rib_height',
    ]);
    for (const p of result.params) {
      expect(p.min).toBeLessThan(p.max);
      expect(p.value).toBeGreaterThanOrEqual(p.min);
      expect(p.value).toBeLessThanOrEqual(p.max);
      for (const end of [p.min, p.max]) expect(check(model, envOf(model, { [p.name]: end }))).toEqual([]);
    }
    // three ribs would run into the countersinks
    const ribs = result.params.find((p) => p.name === 'rib_count')!;
    expect([ribs.min, ribs.max]).toEqual([1, 2]);
  });
});
