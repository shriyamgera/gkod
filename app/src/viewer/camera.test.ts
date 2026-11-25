import { PerspectiveCamera, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { fits, frame, orbitBy, zoomBy } from './camera';
import type { Bounds } from './grid';

const stand: Bounds = { min: [0, 0, 0], max: [80, 90, 103.4] };

function camera(aspect = 1.5) {
  const cam = new PerspectiveCamera(30, aspect, 0.1, 1000);
  cam.up.set(0, 0, 1);
  return cam;
}

/** Left, right, bottom and top of the box in the picture, from -1 to 1. */
function extent(cam: PerspectiveCamera, b: Bounds) {
  cam.updateMatrixWorld();
  const xs: number[] = [];
  const ys: number[] = [];
  for (let i = 0; i < 8; i++) {
    const p = new Vector3(i & 1 ? b.max[0] : b.min[0], i & 2 ? b.max[1] : b.min[1], i & 4 ? b.max[2] : b.min[2]);
    p.project(cam);
    xs.push(p.x);
    ys.push(p.y);
  }
  return [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)] as const;
}

describe('frame', () => {
  it('fills most of the picture with the whole part, centred, seen from above the front', () => {
    const cam = camera();
    const target = frame(cam, stand);
    expect(fits(cam, stand)).toBe(true);
    const [left, right, bottom, top] = extent(cam, stand);
    expect((left + right) / 2).toBeCloseTo(0, 1);
    expect((bottom + top) / 2).toBeCloseTo(0, 1);
    expect(Math.max(right - left, top - bottom)).toBeGreaterThan(1.5);
    expect(cam.position.z).toBeGreaterThan(target.z);
    expect(cam.position.y).toBeLessThan(0);
  });

  it('fits a tall narrow view and a flat wide part', () => {
    const tall = camera(0.5);
    frame(tall, stand);
    expect(fits(tall, stand)).toBe(true);

    const plate: Bounds = { min: [-60, -20, 0], max: [60, 20, 3] };
    const wide = camera(2);
    frame(wide, plate);
    expect(fits(wide, plate)).toBe(true);
  });
});

describe('fits', () => {
  it('is true after a small size change and false after a large one', () => {
    const cam = camera();
    frame(cam, stand);
    expect(fits(cam, { min: [0, 0, 0], max: [90, 90, 103.4] })).toBe(true);
    expect(fits(cam, { min: [0, 0, 0], max: [400, 90, 103.4] })).toBe(false);
  });

  it('is false when the camera is inside the part', () => {
    const cam = camera();
    const target = frame(cam, stand);
    zoomBy(cam, target, 0.01, 1, 1000);
    expect(fits(cam, stand)).toBe(false);
  });
});

describe('orbitBy', () => {
  it('keeps the distance and stops short of the poles', () => {
    const cam = camera();
    const target = new Vector3(0, 0, 0);
    cam.position.set(100, 0, 0);
    orbitBy(cam, target, Math.PI / 2, 0);
    expect(cam.position.x).toBeCloseTo(0, 4);
    expect(cam.position.y).toBeCloseTo(100, 4);
    orbitBy(cam, target, 0, -10);
    expect(cam.position.z).toBeCloseTo(100, 1);
    expect(cam.position.length()).toBeCloseTo(100, 4);
  });
});

describe('zoomBy', () => {
  it('stays inside the limits', () => {
    const cam = camera();
    const target = new Vector3(0, 0, 0);
    cam.position.set(0, -100, 0);
    zoomBy(cam, target, 0.5, 80, 400);
    expect(cam.position.y).toBeCloseTo(-80, 4);
    zoomBy(cam, target, 100, 80, 400);
    expect(cam.position.y).toBeCloseTo(-400, 4);
  });
});
