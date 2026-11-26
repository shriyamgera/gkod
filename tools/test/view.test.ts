import { describe, expect, it } from 'vitest';
import { basisFor, cross, dot, frameFor, toPixel, type Vec3, VIEWS } from '../src/render/view.ts';

const close = (a: Vec3, b: Vec3) => a.forEach((v, k) => expect(v).toBeCloseTo(b[k]!, 9));

describe('basisFor', () => {
  it('gives each view three unit directions at right angles, right x up = back', () => {
    for (const view of VIEWS) {
      const { right, up, back } = basisFor(view);
      for (const v of [right, up, back]) expect(dot(v, v)).toBeCloseTo(1, 9);
      expect(dot(right, up)).toBeCloseTo(0, 9);
      expect(dot(right, back)).toBeCloseTo(0, 9);
      close(cross(right, up), back);
    }
  });

  it('keeps Z up on the picture in every view but the top one', () => {
    for (const view of ['iso', 'front', 'side'] as const) expect(basisFor(view).up[2]).toBeGreaterThan(0);
    close(basisFor('top').back, [0, 0, 1]);
  });

  it('looks at the iso view from the front right and above, like the site viewer', () => {
    const { back, right } = basisFor('iso');
    expect(back[0]).toBeGreaterThan(0);
    expect(back[1]).toBeLessThan(0);
    expect(back[2]).toBeGreaterThan(0);
    expect(right[2]).toBeCloseTo(0, 9);
  });
});

describe('toPixel', () => {
  const basis = basisFor('front');
  const frame = { scale: 2, mid: [0, 0] as [number, number], centreX: 100, centreY: 50, span: [0, 0] as [number, number] };

  it('maps X to the right and Z upwards in the front view', () => {
    close(toPixel([0, 0, 0], basis, frame), [100, 50, 0]);
    close(toPixel([10, 0, 0], basis, frame), [120, 50, 0]);
    close(toPixel([0, 0, 10], basis, frame), [100, 30, 0]);
  });

  it('gives points nearer the camera a bigger depth', () => {
    expect(toPixel([0, -5, 0], basis, frame)[2]).toBeGreaterThan(toPixel([0, 5, 0], basis, frame)[2]);
  });
});

describe('frameFor', () => {
  const box: Vec3[] = [];
  for (const x of [0, 80]) for (const y of [0, 90]) for (const z of [0, 103]) box.push([x, y, z]);

  it('fits every corner inside the margins and fills one direction', () => {
    for (const view of VIEWS) {
      const basis = basisFor(view);
      const [width, height, margin, bottom] = [900, 700, 40, 30];
      const frame = frameFor(box, basis, width, height, margin, bottom);
      const pixels = box.map((p) => toPixel(p, basis, frame));
      const xs = pixels.map((p) => p[0]), ys = pixels.map((p) => p[1]);
      const [left, right, top, low] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
      expect(left).toBeGreaterThanOrEqual(margin - 1e-6);
      expect(right).toBeLessThanOrEqual(width - margin + 1e-6);
      expect(top).toBeGreaterThanOrEqual(margin - 1e-6);
      expect(low).toBeLessThanOrEqual(height - margin - bottom + 1e-6);
      const fillsX = Math.abs(right - left - (width - 2 * margin)) < 1e-6;
      const fillsY = Math.abs(low - top - (height - 2 * margin - bottom)) < 1e-6;
      expect(fillsX || fillsY).toBe(true);
      // centred in the room left for it
      expect((left + right) / 2).toBeCloseTo(width / 2, 6);
      expect((top + low) / 2).toBeCloseTo(margin + (height - 2 * margin - bottom) / 2, 6);
    }
  });

  it('reports the size it fitted, in mm', () => {
    const frame = frameFor(box, basisFor('front'), 500, 500, 10);
    expect(frame.span[0]).toBeCloseTo(80, 9);
    expect(frame.span[1]).toBeCloseTo(103, 9);
    expect(frame.scale).toBeCloseTo(480 / 103, 9);
  });

  it('copes with a single point', () => {
    const frame = frameFor([[1, 2, 3]], basisFor('iso'), 100, 100, 10);
    expect(Number.isFinite(frame.scale)).toBe(true);
    const [x, y] = toPixel([1, 2, 3], basisFor('iso'), frame);
    expect(x).toBeCloseTo(50, 6);
    expect(y).toBeCloseTo(50, 6);
  });
});
