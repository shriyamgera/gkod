import { describe, expect, it } from 'vitest';
import { bedArea, GRID_MM, sceneBounds } from './grid';

describe('bedArea', () => {
  it('reaches past the part on whole grid lines, at the bottom of the part', () => {
    const bed = bedArea({ min: [0, 0, 0], max: [80, 90, 103.4] });
    expect(bed).toEqual({ min: [-10, -10, 0], max: [90, 100, 0] });
  });

  it('stays put for a small size change', () => {
    const before = bedArea({ min: [0, 0, 0], max: [80, 90, 50] });
    const after = bedArea({ min: [0, 0, 0], max: [82, 90, 50] });
    expect(after.min).toEqual(before.min);
    expect(after.max[0]! - before.max[0]!).toBeLessThanOrEqual(GRID_MM);
  });

  it('snaps odd positions outwards', () => {
    const bed = bedArea({ min: [-3.5, 1.2, 2], max: [7, 8.8, 9] });
    expect(bed).toEqual({ min: [-20, -10, 2], max: [20, 20, 2] });
  });
});

describe('sceneBounds', () => {
  it('covers the bed and the full height of the part', () => {
    expect(sceneBounds({ min: [0, 0, 0], max: [20, 10, 12] })).toEqual({ min: [-10, -10, 0], max: [30, 20, 12] });
  });
});
