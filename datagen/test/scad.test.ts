import { describe, expect, it } from 'vitest';
import {
  add,
  cube,
  cylinder,
  difference,
  div,
  each,
  evaluate,
  expr,
  lines,
  max,
  mul,
  num,
  print,
  ref,
  refs,
  sub,
  translate,
} from '../src/scad.ts';

const w = ref('width');
const t = ref('thickness');

describe('expressions', () => {
  it('prints numbers one fixed way', () => {
    expect(num(0.1 + 0.2)).toBe('0.3');
    expect(num(-0)).toBe('0');
    expect(num(1e-7)).toBe('0');
    expect(num(80)).toBe('80');
    expect(num(2.123456)).toBe('2.1235');
    expect(() => num(Number.NaN)).toThrow(RangeError);
  });

  it('folds plain numbers and drops zeros and ones', () => {
    expect(add(2, 3)).toBe(5);
    expect(add(w, 0)).toBe(w);
    expect(mul(1, w)).toBe(w);
    expect(mul(0, w)).toBe(0);
    expect(expr(add(w, -1))).toBe('width - 1');
    expect(expr(sub(t, -2))).toBe('thickness + 2');
  });

  it('adds brackets only where they are needed', () => {
    expect(expr(sub(w, mul(2, t)))).toBe('width - 2 * thickness');
    expect(expr(div(sub(w, t), 2))).toBe('(width - thickness) / 2');
    expect(expr(sub(w, sub(t, 1)))).toBe('width - (thickness - 1)');
    expect(expr(sub(sub(w, t), 1))).toBe('width - thickness - 1');
    expect(expr(div(w, mul(2, t)))).toBe('width / (2 * thickness)');
    expect(expr(max(t, 3))).toBe('max(thickness, 3)');
  });

  it('evaluates with the sizes and lists the names used', () => {
    const e = div(sub(w, mul(2, t)), max(t, 3));
    expect(evaluate(e, { width: 80, thickness: 4 })).toBe(18);
    expect([...refs(e)].sort()).toEqual(['thickness', 'width']);
    expect(() => evaluate(w, {})).toThrow('Unknown size: width');
  });
});

describe('statements', () => {
  it('keeps a chain of single children on one line', () => {
    const hole = translate([10, 10, -1], cylinder({ d: ref('hole_d'), h: add(t, 2) }));
    expect(lines(hole)).toEqual(['translate([10, 10, -1]) cylinder(d = hole_d, h = thickness + 2);']);
  });

  it('skips a translate by zero', () => {
    expect(translate([0, 0, 0], cube([w, 1, 1]))).toEqual(cube([w, 1, 1]));
  });

  it('writes blocks and loops', () => {
    const node = difference(
      cube([w, 20, t]),
      each([['x', [5, sub(w, 5)]]], translate([ref('x'), 10, -1], cylinder({ d: 3, h: add(t, 2) }))),
    );
    expect(lines(node)).toEqual([
      'difference() {',
      '  cube([width, 20, thickness]);',
      '  for (x = [5, width - 5]) translate([x, 10, -1]) cylinder(d = 3, h = thickness + 2);',
      '}',
    ]);
    expect(lines(each([['i', { from: 0, to: sub(ref('n'), 1) }]], cube([1, 1, 1])))).toEqual([
      'for (i = [0 : n - 1]) cube([1, 1, 1]);',
    ]);
  });

  it('prints a whole file in the site format', () => {
    const code = print({
      title: 'Test block',
      params: [{ name: 'width', caption: 'Block width (mm)', value: 20, min: 10, step: 1, max: 40 }],
      hidden: [{ name: '$fn', value: 48 }],
      modules: [{ name: 'block', body: [cube([w, w, 5])] }],
      main: [{ name: 'block' }],
    });
    expect(code).toBe(
      [
        '// Test block',
        '',
        '// Block width (mm)',
        'width = 20; // [10:1:40]',
        '',
        '/* [Hidden] */',
        '$fn = 48;',
        '',
        'module block() {',
        '  cube([width, width, 5]);',
        '}',
        '',
        'block();',
        '',
      ].join('\n'),
    );
  });
});
