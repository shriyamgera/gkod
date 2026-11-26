import { describe, expect, it } from 'vitest';
import { checkMesh } from '#checks/index';
import { blockWithHole, box, bridge, cells, leaningWall, prism, sphere, toPositions, tShape, type Triangle } from './shapes';

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
    // how far the biggest area reaches, so a fix holds up all of it
    expect(result.fix).toMatch(
      /There are 2 problem areas; the biggest is underneath at z = 30 mm and spans x = (0 to 25|35 to 60) mm and y = 0 to 20 mm\. Whatever holds it up, such as a slope of at most 45 degrees from vertical, must reach all of it\./,
    );
    // both undersides are marked: two triangles each, flat at z = 30, facing down
    expect(result.triangles).toHaveLength(4);
    for (const t of result.triangles!) {
      const [a, b, c] = triangles[t]!;
      expect([a[2], b[2], c[2]]).toEqual([30, 30, 30]);
    }
    // the marker sits on the far end of the top, the point farthest from the stem that holds it up
    const [x, y, z] = result.at!;
    expect([0, 60]).toContain(Math.round(x * 10) / 10);
    expect(y).toBeCloseTo(10, 6);
    expect(z).toBeCloseTo(30, 6);
  });

  it('passes a short bridge and fails a long one', () => {
    expect(overhang(bridge(8)).ok).toBe(true);
    const long = overhang(bridge(20));
    expect(long.ok).toBe(false);
    expect(long.detail).toBe('An area underneath, about 400 mm² and 20 mm above the bed, would sag while printing.');
    expect(long.fix).toContain('The problem area is underneath at z = 20 mm and spans x = 10 to 30 mm and y = 0 to 20 mm.');
  });

  it('passes a small hole through a block lying on its side', () => {
    const result = overhang(blockWithHole(20, 20, 5));
    expect(result.ok).toBe(true);
    expect(result.detail).toBe('Nothing underneath would need supports.');
  });

  it('fails a large hole through a block lying on its side', () => {
    expect(overhang(blockWithHole(20, 30, 20)).ok).toBe(false);
  });

  it('ignores a shallow recess in the bottom, which sags onto the bed', () => {
    const recessed = (depth: number) =>
      cells([0, 1, 39, 40], [0, 1, 39, 40], [0, depth, 10], (i, j, k) => k === 1 || i !== 1 || j !== 1);
    expect(overhang(recessed(0.5)).ok).toBe(true);
    expect(overhang(recessed(3)).ok).toBe(false);
  });

  it('passes a wall leaning 30 degrees and fails one leaning 60', () => {
    expect(overhang(leaningWall(30)).ok).toBe(true);
    expect(overhang(leaningWall(60)).ok).toBe(false);
  });

  it('passes an exact 45 degree slope and fails one just past it', () => {
    expect(overhang(leaningWall(45)).ok).toBe(true);
    expect(overhang(leaningWall(45.5)).ok).toBe(false);
  });

  it('uses the limit it is given', () => {
    expect(overhang(leaningWall(60), 65).ok).toBe(true);
    expect(overhang(leaningWall(30), 20).ok).toBe(false);
    expect(overhang(leaningWall(30.5), 30).ok).toBe(false);
  });

  it('fails a piece floating above another, with nothing holding it up', () => {
    const result = overhang([...box([0, 0, 0], [20, 20, 10]), ...box([0, 0, 15], [20, 20, 25])]);
    expect(result.ok).toBe(false);
    expect(result.at![2]).toBeCloseTo(15, 6);
  });

  it('fails a small piece floating in the air, however small its underside', () => {
    const cube = box([0, 0, 0], [20, 20, 20]);
    // a 4 x 4 mm rod 10 mm above the bed: 16 mm² underneath, under the 20 mm² that counts for a held-up patch
    const rod = overhang([...cube, ...box([30, 0, 10], [34, 4, 50])]);
    expect(rod.ok).toBe(false);
    expect(rod.detail).toBe('An area underneath, about 16 mm² and 10 mm above the bed, would sag while printing.');
    const beads = Array.from({ length: 10 }, (_, i) => box([30 + i * 6, 0, 40], [32 + i * 6, 2, 42])).flat();
    expect(overhang([...cube, ...beads]).detail).toMatch(/^10 areas underneath would sag while printing/);
  });

  it('counts a plate below as holding an overhang that meets it at an inside corner', () => {
    // a 5 mm plate; above it, a slope leaning 73 degrees rises from the plate's top and reaches `run` mm out over it
    const plate = (run: number) =>
      prism([[0, 0], [40, 0], [40, 5], [20, 5], [20 + run, 5 + run * 0.3], [20 + run, 12], [0, 12]], 20);
    expect(overhang(plate(4)).ok).toBe(true);
    expect(overhang(plate(10)).ok).toBe(false);
  });

  // a 10 mm stem with steps that each reach `tread` mm further out and sit `riser` mm higher, under a 3 mm top
  function staircase(tread: number, riser: number, steps: number) {
    const xs = [0, 10, ...Array.from({ length: steps }, (_, i) => 10 + (i + 1) * tread)];
    const zs = [0, 10, ...Array.from({ length: steps }, (_, i) => 10 + (i + 1) * riser), 10 + steps * riser + 3];
    return cells(xs, [0, 20], zs, (i, _j, k) => k >= i);
  }

  it('adds up the reach of steps that each hang from the one below', () => {
    // each step reaches 4.9 mm, under the 5 mm limit, but together they lean about 88 degrees
    const flat = overhang(staircase(4.9, 0.2, 8));
    expect(flat.ok).toBe(false);
    expect(flat.detail).toMatch(/^7 areas underneath would sag/);
    // steps as tall as they are deep make a 45 degree slope
    expect(overhang(staircase(2, 2, 8)).ok).toBe(true);
  });

  it('does not count a wall that hangs in the air as holding anything up', () => {
    // a 10 mm arm from a post, with a 1 mm lip hanging 3 mm from its free end
    const arm = (lip: boolean) =>
      cells([0, 10, 19, 20], [0, 14], [0, 23, 26, 30], (i, _j, k) => i === 0 || k === 2 || (lip && i === 2 && k === 1));
    expect(overhang(arm(false)).detail).toBe('An area underneath, about 140 mm² and 26 mm above the bed, would sag while printing.');
    expect(overhang(arm(true)).detail).toMatch(/^2 areas underneath would sag while printing; the biggest is about 126 mm²/);
  });

  it('gives the same answer whatever the order of the triangles', () => {
    // an upside-down box whose 28 mm roof is 14 mm from the walls in the middle, cut finely near the walls only
    const fine = Array.from({ length: 21 }, (_, i) => 1 + i * 0.25);
    const xs = [...new Set([0, ...fine, ...fine.map((v) => 30 - v), 30])].sort((a, b) => a - b);
    const n = xs.length - 1;
    const roof = cells(xs, xs, [0, 20, 23], (i, j, k) => k === 1 || i === 0 || j === 0 || i === n - 1 || j === n - 1);
    const middle = roof.filter((t) => t.every(([x, y, z]) => z === 20 && x >= 6 && x <= 24 && y >= 6 && y <= 24));
    expect(middle).toHaveLength(2);
    const rest = roof.filter((t) => !middle.includes(t));
    for (let at = 0; at < 4000; at += 500) {
      expect(overhang([...rest.slice(0, at), ...middle, ...rest.slice(at)]).ok).toBe(false);
    }
  });

  it('ignores a small patch underneath, even one that reaches out', () => {
    // a ledge 3 mm wide sticking out 6 mm: 18 mm² underneath
    const ledge = (width: number) =>
      cells([0, 10, 16], [0, 5 - width / 2, 5 + width / 2, 10], [0, 10, 12, 20], (i, j, k) => i === 0 || (j === 1 && k === 1));
    expect(overhang(ledge(3)).ok).toBe(true);
    expect(overhang(ledge(4)).ok).toBe(false);
  });

  it('puts the marker on the part of a ring-shaped area that sags, not on the edge by the stem', () => {
    const grid = [0, 45, 55, 100];
    const mushroom = cells(grid, grid, [0, 10, 12], (i, j, k) => k === 1 || (i === 1 && j === 1));
    const [x, y, z] = overhang(mushroom).at!;
    // the stem is 10 mm wide, and the cap only sags more than 5 mm from it
    expect(Math.max(Math.abs(x - 50), Math.abs(y - 50))).toBeGreaterThan(10);
    expect(z).toBeCloseTo(10, 6);
  });

  it('fails the underside of a ball resting on its lowest point, and says how high the area reaches', () => {
    const result = overhang(sphere(15, 48, 24, [0, 0, 15]));
    expect(result.ok).toBe(false);
    // the area runs from the faces just above the ones that sag onto the bed, up to where the faces lean 45 degrees
    expect(result.detail).toBe('An area underneath, about 305 mm² and 0.5 to 4.4 mm above the bed, would sag while printing.');
    // the marker is on the outer edge of the area, the part farthest from the faces on the bed
    const [x, y, z] = result.at!;
    expect(Math.hypot(x, y)).toBeGreaterThan(9);
    expect(z).toBeGreaterThan(4);
  });
});
