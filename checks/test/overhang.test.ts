import { describe, expect, it } from 'vitest';
import { checkMesh } from '#checks/index';
import { blockWithHole, box, bridge, cells, leaningWall, sphere, toPositions, tShape, type Triangle } from './shapes';

function overhang(triangles: Triangle[], overhangDeg?: number) {
  const report = checkMesh(toPositions(triangles), overhangDeg === undefined ? {} : { overhangDeg });
  return report.results[3]!;
}

describe('overhang', () => {
  it('passes a cube: its bottom rests on the bed', () => {
    expect(overhang(box([0, 0, 0], [20, 20, 20])).ok).toBe(true);
  });

  it('fails the wide top of a T and marks where it would sag', () => {
    const triangles = tShape();
    const result = overhang(triangles);
    expect(result.ok).toBe(false);
    expect(result.detail).toBe(
      '2 areas underneath would sag while printing; the biggest is about 500 mm² and 30 mm above the bed.',
    );
    expect(result.fix).toMatch(/^Change the design so no surface underneath leans more than 45 degrees from vertical/);
    // both undersides are marked: two triangles each, flat at z = 30, facing down
    expect(result.triangles).toHaveLength(4);
    for (const t of result.triangles!) {
      const [a, b, c] = triangles[t]!;
      expect([a[2], b[2], c[2]]).toEqual([30, 30, 30]);
    }
    const [x, y, z] = result.at!;
    expect([12.5, 47.5]).toContain(Math.round(x * 10) / 10);
    expect(y).toBeCloseTo(10, 6);
    expect(z).toBeCloseTo(30, 6);
  });

  it('passes a short bridge and fails a long one', () => {
    expect(overhang(bridge(8)).ok).toBe(true);
    const long = overhang(bridge(20));
    expect(long.ok).toBe(false);
    expect(long.detail).toBe('An area underneath, about 400 mm² and 20 mm above the bed, would sag while printing.');
  });

  it('passes a small hole through a block lying on its side', () => {
    const result = overhang(blockWithHole(20, 20, 5));
    expect(result.ok).toBe(true);
    expect(result.detail).toBe('Nothing underneath would need supports.');
  });

  it('fails a large hole through a block lying on its side', () => {
    expect(overhang(blockWithHole(20, 30, 20)).ok).toBe(false);
  });

  it('passes a wall leaning 30 degrees and fails one leaning 60', () => {
    expect(overhang(leaningWall(30)).ok).toBe(true);
    expect(overhang(leaningWall(60)).ok).toBe(false);
  });

  it('passes an exact 45 degree slope', () => {
    expect(overhang(leaningWall(45)).ok).toBe(true);
  });

  it('uses the limit it is given', () => {
    expect(overhang(leaningWall(60), 65).ok).toBe(true);
    expect(overhang(leaningWall(30), 20).ok).toBe(false);
  });

  it('fails a piece floating above another, with nothing holding it up', () => {
    const result = overhang([...box([0, 0, 0], [20, 20, 10]), ...box([0, 0, 15], [20, 20, 25])]);
    expect(result.ok).toBe(false);
    expect(result.at![2]).toBeCloseTo(15, 6);
  });

  it('ignores a small patch underneath, even one that reaches out', () => {
    // a ledge 3 mm wide sticking out 6 mm: 18 mm² underneath
    const ledge = (width: number) =>
      cells([0, 10, 16], [0, 5 - width / 2, 5 + width / 2, 10], [0, 10, 12, 20], (i, j, k) => i === 0 || (j === 1 && k === 1));
    expect(overhang(ledge(3)).ok).toBe(true);
    expect(overhang(ledge(4)).ok).toBe(false);
  });

  it('puts the marker on a ring-shaped area, not in its empty middle', () => {
    const grid = [0, 45, 55, 100];
    const mushroom = cells(grid, grid, [0, 10, 12], (i, j, k) => k === 1 || (i === 1 && j === 1));
    const [x, y, z] = overhang(mushroom).at!;
    expect(Math.max(Math.abs(x - 50), Math.abs(y - 50))).toBeGreaterThanOrEqual(5);
    expect(z).toBeCloseTo(10, 6);
  });

  it('fails the underside of a ball resting on its lowest point', () => {
    const result = overhang(sphere(10, 24, 12, [0, 0, 10]));
    expect(result.ok).toBe(false);
    expect(result.at![2]).toBeLessThan(5);
  });
});
