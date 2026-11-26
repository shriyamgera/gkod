import { describe, expect, it } from 'vitest';
import { type CheckId, checkFits, checkMesh, checkStl, type Report, withBed } from '#checks/index';
import {
  blockWithHole,
  box,
  bridge,
  brokenBox,
  cells,
  insideOut,
  leaningWall,
  prism,
  sphere,
  toPositions,
  toStl,
  tShape,
  type Triangle,
} from './shapes';

const cube = box([0, 0, 0], [20, 20, 20]);

function result(report: Report, id: CheckId) {
  const found = report.results.find((r) => r.id === id);
  if (!found) throw new Error(`no ${id} result`);
  return found;
}

const run = (triangles: Triangle[], opts?: Parameters<typeof checkMesh>[1]) => checkMesh(toPositions(triangles), opts);

describe('report', () => {
  it('passes a 20 mm cube and lists the checks in a fixed order', () => {
    const report = run(cube);
    expect(report.ok).toBe(true);
    expect(report.results.map((r) => r.id)).toEqual(['closed', 'fits-bed', 'flat-base', 'overhang']);
    expect(report.results.map((r) => r.title)).toEqual([
      'Solid, no holes',
      'Fits your printer (256 mm bed)',
      'Sits flat on the bed',
      'No steep overhangs',
    ]);
    expect(report.results.every((r) => r.fix === undefined)).toBe(true);
    expect(report.stats.triangles).toBe(12);
    expect(report.stats.volume).toBeCloseTo(8000, 6);
    expect(report.stats.size).toEqual([20, 20, 20]);
    expect(report.stats.min).toEqual([0, 0, 0]);
    expect(report.ms).toBeGreaterThanOrEqual(0);
  });

  it('gives the same report for a binary STL file', () => {
    const fromStl = checkStl(toStl(cube));
    const fromMesh = run(cube);
    expect(fromStl.results).toEqual(fromMesh.results);
    expect(fromStl.stats).toEqual(fromMesh.stats);
    expect(checkStl(toStl(cube).buffer as ArrayBuffer).ok).toBe(true);
  });

  it('gives every failure a sentence and a fix', () => {
    const report = run(sphere(10, 24, 12, [0, 0, 10]));
    const failures = report.results.filter((r) => !r.ok);
    expect(failures.map((r) => r.id)).toEqual(['flat-base', 'overhang']);
    for (const failure of failures) {
      expect(failure.detail).toMatch(/^[A-Z].*\.$/);
      expect(failure.fix).toMatch(/^Change the design .*keep every named size/);
    }
  });

  it('rejects input it cannot read', () => {
    expect(() => checkMesh(new Float32Array(10))).toThrow(/nine numbers per triangle/);
    expect(() => checkMesh(new Float32Array([0, 0, 0, 1, 0, 0, 0, NaN, 0]))).toThrow(/not a number/);
    expect(() => run(cube, { bed: { x: 0, y: 200, z: 200 } })).toThrow(RangeError);
    expect(() => run(cube, { overhangDeg: 120 })).toThrow(RangeError);
    expect(() => checkStl(new Uint8Array(40))).toThrow(/too short/);
    const text = new TextEncoder().encode(`solid cube\n${' '.repeat(100)}`);
    expect(() => checkStl(text)).toThrow(/text STL/);
    const cut = toStl(cube).slice(0, 84 + 50 * 5);
    expect(() => checkStl(cut)).toThrow(/cut short/);
  });
});

describe('closed shape', () => {
  it('finds the gap when a side is missing', () => {
    const closed = result(run(brokenBox([0, 0, 0], [20, 20, 20], '+y', 'missing')), 'closed');
    expect(closed.ok).toBe(false);
    expect(closed.detail).toBe('The surface has gaps, so it is not a closed solid (4 open edges).');
  });

  it('finds a side turned inside out', () => {
    const closed = result(run(brokenBox([0, 0, 0], [20, 20, 20], '+x', 'flipped')), 'closed');
    expect(closed.ok).toBe(false);
    expect(closed.detail).toBe('Some faces are turned inside out (4 edges where neighbouring faces disagree).');
  });

  it('finds a whole shape turned inside out', () => {
    const closed = result(run(insideOut(cube)), 'closed');
    expect(closed.ok).toBe(false);
    expect(closed.detail).toMatch(/inside out: all of its faces point inwards/);
  });

  it('finds two pieces that touch only along an edge', () => {
    const closed = result(run([...box([0, 0, 0], [10, 10, 10]), ...box([10, 10, 0], [20, 20, 10])]), 'closed');
    expect(closed.ok).toBe(false);
    expect(closed.detail).toMatch(/^Some edges are shared by more than two faces/);
  });

  it('finds a closed surface with no volume', () => {
    const flat: Triangle = [[0, 0, 0], [10, 0, 0], [0, 10, 0]];
    const closed = result(run([flat, [flat[0], flat[2], flat[1]]]), 'closed');
    expect(closed.ok).toBe(false);
    expect(closed.detail).toMatch(/no volume/);
  });

  it('fails an empty file', () => {
    const report = checkMesh(new Float32Array(0));
    expect(result(report, 'closed').detail).toMatch(/no triangles/);
    expect(report.ok).toBe(false);
    expect(report.stats.size).toEqual([0, 0, 0]);
  });

  it('ignores triangles with no area but counts them', () => {
    const sliver: Triangle = [[0, 0, 20], [0, 0, 20], [20, 0, 20]];
    const report = run([...cube, sliver]);
    expect(report.ok).toBe(true);
    expect(report.stats.triangles).toBe(13);
  });

  it('joins corners that differ only by float rounding', () => {
    const nudged = cube.map(([a, b, c]): Triangle => [a, b, [c[0] + 0.00001, c[1], c[2]]]);
    expect(result(run(nudged), 'closed').ok).toBe(true);
  });

  it('joins close corners on either side of a 0.0001 mm grid line', () => {
    // 0.0000499 and 0.0000501 are 0.0000002 mm apart, but round to different multiples of 0.0001
    let k = 0;
    const split = cube.map((t) => t.map(([x, y, z]): [number, number, number] => [x === 0 ? (k++ % 2 ? 0.0000499 : 0.0000501) : x, y, z]) as Triangle);
    expect(result(run(split), 'closed').ok).toBe(true);
  });

  it('accepts every test shape built in code', () => {
    const shapes: [Triangle[], number][] = [
      [tShape(), 60 * 20 * 5 + 10 * 20 * 30],
      [bridge(20), 2 * 10 * 20 * 20 + 40 * 20 * 5],
      [leaningWall(60), 5 * 20 * 20],
      [blockWithHole(20, 20, 5, 32), 20 * 20 * 20 - 16 * 2.5 ** 2 * Math.sin(Math.PI / 16) * 20],
      [sphere(10, 24, 12, [0, 0, 10]), 0],
    ];
    for (const [triangles, volume] of shapes) {
      const report = run(triangles);
      expect(result(report, 'closed').ok).toBe(true);
      if (volume > 0) expect(report.stats.volume).toBeCloseTo(volume, 2);
    }
  });

  it('accepts several separate closed pieces', () => {
    expect(result(run([...cube, ...box([30, 0, 0], [40, 10, 10])]), 'closed').ok).toBe(true);
  });

  it('finds a separate piece turned inside out, even beside a bigger piece that faces outwards', () => {
    const closed = result(run([...cube, ...insideOut(box([30, 0, 0], [40, 10, 10]))]), 'closed');
    expect(closed.ok).toBe(false);
    expect(closed.detail).toBe('A separate piece is inside out: its faces point inwards.');
  });

  it('accepts a hollow, whose inner wall faces inwards, and fails a second solid inside the first', () => {
    const outer = box([0, 0, 0], [40, 40, 40]);
    const inner = box([10, 10, 10], [30, 30, 30]);
    expect(result(run([...outer, ...insideOut(inner)]), 'closed').ok).toBe(true);
    const overlap = result(run([...outer, ...inner]), 'closed');
    expect(overlap.ok).toBe(false);
    expect(overlap.detail).toBe('A piece sits inside another piece, so the solid overlaps itself.');
    // a solid island inside the hollow is fine again
    const island = box([15, 15, 15], [25, 25, 25]);
    expect(result(run([...outer, ...insideOut(inner), ...island]), 'closed').ok).toBe(true);
  });
});

describe('fits the bed', () => {
  it('says which side is too big and by how much', () => {
    const fits = result(run(box([0, 0, 0], [300, 20, 20])), 'fits-bed');
    expect(fits.ok).toBe(false);
    expect(fits.detail).toBe('It is 44 mm too wide (300 mm in X) for a 256 x 256 x 256 mm bed.');
    expect(fits.fix).toMatch(/fits in 256 x 256 x 256 mm/);
  });

  it('names every side that is too big', () => {
    const fits = result(run(box([0, 0, 0], [20, 260, 300])), 'fits-bed');
    expect(fits.detail).toBe('It is 4 mm too deep (260 mm in Y) and 44 mm too tall (300 mm in Z) for a 256 x 256 x 256 mm bed.');
  });

  it('uses the bed it is given', () => {
    const bed = { x: 220, y: 220, z: 250 };
    const fits = result(run(box([0, 0, 0], [20, 20, 240]), { bed }), 'fits-bed');
    expect(fits.ok).toBe(true);
    expect(fits.title).toBe('Fits your printer (220 x 220 x 250 mm bed)');
    expect(fits.detail).toBe('It measures 20 x 20 x 240 mm.');
    expect(result(run(box([0, 0, 0], [230, 20, 20]), { bed }), 'fits-bed').ok).toBe(false);
  });

  it('accepts a part exactly the size of the bed', () => {
    expect(result(run(box([0, 0, 0], [256, 256, 256])), 'fits-bed').ok).toBe(true);
  });

  it('names the printer in the title when it is given one', () => {
    expect(checkFits([20, 20, 20], { x: 220, y: 220, z: 250 }, 'Kobra 2 Neo').title).toBe('Fits your printer (Kobra 2 Neo, 220 mm bed)');
    expect(checkFits([20, 20, 20], { x: 250, y: 210, z: 220 }, 'MK3S').title).toBe('Fits your printer (MK3S, 250 x 210 mm bed)');
  });

  it('measures a report against another printer without checking again', () => {
    const long = run(box([0, 0, 0], [240, 20, 10]));
    const kobra = withBed(long, { x: 220, y: 220, z: 250 }, 'Kobra 2 Neo');
    expect(kobra.ok).toBe(false);
    expect(result(kobra, 'fits-bed').detail).toBe('It is 20 mm too wide (240 mm in X) for a 220 x 220 x 250 mm bed.');
    const big = withBed(kobra, { x: 300, y: 300, z: 300 }, 'Ender-3 S1 Plus');
    expect(big.ok).toBe(true);
    expect(result(big, 'fits-bed').title).toBe('Fits your printer (Ender-3 S1 Plus, 300 mm bed)');
    expect(big.results.filter((r) => r.id !== 'fits-bed')).toEqual(long.results.filter((r) => r.id !== 'fits-bed'));
    expect(big.stats).toBe(long.stats);
  });
});

describe('flat base', () => {
  it('passes a cube with its whole bottom on the bed', () => {
    const base = result(run(cube), 'flat-base');
    expect(base.ok).toBe(true);
    expect(base.detail).toBe('About 400 mm² rests flat on the bed.');
  });

  it('judges the lowest layer, since the slicer drops a floating part onto the bed', () => {
    const report = run(box([0, 0, 10], [20, 20, 30]));
    expect(report.ok).toBe(true);
    expect(report.stats.min).toEqual([0, 0, 10]);
  });

  it('fails a ball that touches the bed at one point', () => {
    const base = result(run(sphere(10, 24, 12, [0, 0, 10])), 'flat-base');
    expect(base.ok).toBe(false);
    expect(base.detail).toMatch(/^It only touches the bed at a point or along an edge/);
  });

  it('fails a wedge standing on its edge', () => {
    const wedge = prism([[5, 0], [10, 10], [0, 10]], 20);
    expect(result(run(wedge), 'flat-base').detail).toMatch(/at a point or along an edge/);
  });

  it('fails a wide part on a small foot', () => {
    const grid = [0, 47.5, 52.5, 100];
    const mushroom = cells(grid, grid, [0, 10, 12], (i, j, k) => k === 1 || (i === 1 && j === 1));
    const base = result(run(mushroom), 'flat-base');
    expect(base.ok).toBe(false);
    expect(base.detail).toBe('Only about 25 mm² rests flat on the bed; it needs at least 100 mm² to stay put while printing.');
  });

  it('passes a small pin with most of its footprint on the bed', () => {
    expect(result(run(box([0, 0, 0], [3, 3, 10])), 'flat-base').ok).toBe(true);
  });
});
