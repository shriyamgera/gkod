import { describe, expect, it } from 'vitest';
import mixed from './fixtures/mixed.param.json?raw';
import phoneStand from './fixtures/phone_stand.param.json?raw';
import { applyOverrides, parseParams } from './params';

describe('parseParams', () => {
  it('reads the phone stand sizes with their ranges and captions', () => {
    const params = parseParams(phoneStand);
    expect(params.map((p) => p.name)).toEqual(['width', 'depth', 'height', 'angle', 'lip', 'thickness', 'cable_slot']);
    expect(params[0]).toEqual({ name: 'width', value: 80, min: 50, max: 160, step: 1, caption: 'Stand width (mm)' });
    expect(params[5]).toMatchObject({ name: 'thickness', value: 5, min: 3, max: 8, step: 0.5 });
  });

  it('keeps only plain numbers', () => {
    const names = parseParams(mixed).map((p) => p.name);
    expect(names).toEqual(['plain', 'capped', 'stepped', 'span', 'choice', 'small', 'neg', 'zero']);
  });

  it('uses the written range when there is one', () => {
    const byName = Object.fromEntries(parseParams(mixed).map((p) => [p.name, p]));
    expect(byName.capped).toMatchObject({ min: 0, max: 10, step: 1 });
    expect(byName.stepped).toMatchObject({ min: 0, max: 10, step: 0.5 });
    expect(byName.span).toMatchObject({ min: 10, max: 60, step: 1 });
    expect(byName.choice).toMatchObject({ min: 1, max: 3, step: 1 });
  });

  it('makes a range around a number that has none', () => {
    const byName = Object.fromEntries(parseParams(mixed).map((p) => [p.name, p]));
    expect(byName.plain).toMatchObject({ value: 12, min: 6, max: 24, step: 1 });
    expect(byName.small).toMatchObject({ value: 0.4, min: 0.2, max: 0.8, step: 0.1 });
    expect(byName.neg).toMatchObject({ value: -5, min: -10, max: -2, step: 1 });
    expect(byName.zero).toMatchObject({ value: 0, min: -10, max: 10, step: 1 });
    expect(byName.plain?.caption).toBe('Plain number, no range');
    expect(byName.small?.caption).toBeUndefined();
  });

  it('leaves out special variables such as $fn', () => {
    const exported = {
      parameters: [
        { name: '$fn', type: 'number', initial: 6, min: 3, max: 64, step: 1 },
        { name: 'width', type: 'number', initial: 20 },
      ],
    };
    expect(parseParams(exported).map((p) => p.name)).toEqual(['width']);
  });

  it('returns an empty list for output it cannot read', () => {
    expect(parseParams('')).toEqual([]);
    expect(parseParams('{"title":"in"}')).toEqual([]);
    expect(parseParams({ parameters: [null, 3, { name: 'x' }] })).toEqual([]);
  });
});

describe('applyOverrides', () => {
  it('shows the changed value and leaves the rest alone', () => {
    const params = applyOverrides(parseParams(phoneStand), { width: 120, nothing: 1 });
    expect(params[0]?.value).toBe(120);
    expect(params[1]?.value).toBe(90);
  });
});
