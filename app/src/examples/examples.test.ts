import { describe, expect, it } from 'vitest';
import { countSizes, examples, findExample } from './index';

describe('examples', () => {
  it('has unique ids', () => {
    const ids = examples.map((example) => example.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('finds an example by id', () => {
    expect(findExample('wall_hook')?.name).toBe('Wall hook');
    expect(findExample('nope')).toBeUndefined();
  });

  const parts = examples.filter((example) => example.id !== 'test_cube');

  it.each(parts)('$id has 4 to 7 named sizes and avoids slow or unsupported calls', ({ source }) => {
    const sizes = countSizes(source);
    expect(sizes).toBeGreaterThanOrEqual(4);
    expect(sizes).toBeLessThanOrEqual(7);
    expect(source).not.toMatch(/\b(minkowski|text)\s*\(/);
  });

  it('has a 20 mm test cube with one named size and no text', () => {
    const cube = findExample('test_cube');
    expect(cube?.name).toBe('Test cube');
    expect(countSizes(cube!.source)).toBe(1);
    expect(cube!.source).toMatch(/^size = 20; \/\/ \[/m);
    expect(cube!.source).not.toMatch(/\b(minkowski|text)\s*\(/);
  });
});
