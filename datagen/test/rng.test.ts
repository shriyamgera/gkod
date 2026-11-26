import { describe, expect, it } from 'vitest';
import { childSeed, Rng } from '../src/rng.ts';

const draw = (rng: Rng, n: number) => Array.from({ length: n }, () => rng.next());

describe('Rng', () => {
  it('gives the same numbers for the same seed', () => {
    expect(draw(new Rng(1), 50)).toEqual(draw(new Rng(1), 50));
    expect(draw(new Rng(1), 5)).not.toEqual(draw(new Rng(2), 5));
  });

  it('keeps known values, so a change to the generator shows up here', () => {
    const rng = new Rng(42);
    expect([rng.int(0, 999), rng.int(0, 999), rng.int(0, 999)]).toEqual([601, 448, 852]);
  });

  it('stays inside its bounds', () => {
    const rng = new Rng(7);
    for (let i = 0; i < 2000; i++) {
      const x = rng.next();
      expect(x >= 0 && x < 1).toBe(true);
      const n = rng.int(-3, 3);
      expect(Number.isInteger(n) && n >= -3 && n <= 3).toBe(true);
    }
  });

  it('reaches both ends of an int range', () => {
    const rng = new Rng(3);
    const seen = new Set(Array.from({ length: 200 }, () => rng.int(1, 4)));
    expect([...seen].sort()).toEqual([1, 2, 3, 4]);
  });

  it('picks sizes on the step', () => {
    const rng = new Rng(9);
    for (let i = 0; i < 500; i++) {
      const half = rng.size(1.6, 6, 0.5);
      expect(half >= 2 && half <= 6).toBe(true);
      expect(half * 2).toBe(Math.round(half * 2));
      const whole = rng.size(40, 160);
      expect(Number.isInteger(whole)).toBe(true);
    }
    expect(() => rng.size(2.1, 2.4, 0.5)).toThrow(RangeError);
  });

  it('derives child seeds from the index alone', () => {
    const a = new Rng(5);
    const b = new Rng(5);
    draw(b, 100);
    expect(draw(a.child(537), 10)).toEqual(draw(b.child(537), 10));
    expect(childSeed(5, 537)).toBe(a.child(537).seed);
    const seeds = new Set(Array.from({ length: 5000 }, (_, i) => childSeed(1, i)));
    expect(seeds.size).toBe(5000);
  });

  it('refuses seeds that are not 32-bit whole numbers', () => {
    expect(() => new Rng(-1)).toThrow(RangeError);
    expect(() => new Rng(1.5)).toThrow(RangeError);
    expect(() => new Rng(2 ** 32)).toThrow(RangeError);
  });
});
