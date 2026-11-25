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

  it.each(examples)('$id has 4 to 7 named sizes and avoids slow or unsupported calls', ({ source }) => {
    const sizes = countSizes(source);
    expect(sizes).toBeGreaterThanOrEqual(4);
    expect(sizes).toBeLessThanOrEqual(7);
    expect(source).not.toMatch(/\b(minkowski|text)\s*\(/);
  });
});
