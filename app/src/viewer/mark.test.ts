import { PerspectiveCamera } from 'three';
import { describe, expect, it } from 'vitest';
import { labelSpot, markGeometry } from './mark';
import type { Mesh } from './stl';

// Three flat triangles in a row, each 10 mm along x from the one before.
function row(count: number): Mesh {
  const positions = new Float32Array(count * 9);
  for (let t = 0; t < count; t++) positions.set([t * 10, 0, 0, t * 10 + 10, 0, 0, t * 10, 10, 0], t * 9);
  return {
    positions,
    normals: new Float32Array(count * 9),
    triangles: count,
    size: [count * 10, 10, 0],
    min: [0, 0, 0],
    max: [count * 10, 10, 0],
  };
}

describe('markGeometry', () => {
  it('copies only the marked faces', () => {
    const geometry = markGeometry(row(3), [2, 0])!;
    const position = geometry.getAttribute('position');
    expect(position.count).toBe(6);
    expect(position.getX(0)).toBe(20);
    expect(position.getX(3)).toBe(0);
  });

  it('skips faces the mesh does not have, so a mark for an older shape draws nothing wrong', () => {
    expect(markGeometry(row(3), [3, -1, 1.5])).toBeNull();
    expect(markGeometry(row(3), [])).toBeNull();
    expect(markGeometry(row(3), [1, 7])!.getAttribute('position').count).toBe(3);
  });
});

describe('labelSpot', () => {
  function camera() {
    const cam = new PerspectiveCamera(30, 2, 1, 1000);
    cam.up.set(0, 0, 1);
    cam.position.set(0, -100, 0);
    cam.lookAt(0, 0, 0);
    return cam;
  }

  it('puts the point the camera looks at in the middle of the view', () => {
    const spot = labelSpot([0, 0, 0], camera(), 800, 400)!;
    expect(spot.x).toBeCloseTo(400);
    expect(spot.y).toBeCloseTo(200);
    expect(spot.side).toBe('right');
  });

  it('measures down from the top, and moves the label to the left near the right edge', () => {
    const cam = camera();
    expect(labelSpot([0, 0, 10], cam, 800, 400)!.y).toBeLessThan(200);
    expect(labelSpot([50, 0, 0], cam, 800, 400)!.side).toBe('left');
  });

  it('gives nothing for a point behind the camera or outside the picture, so the label never spills off the view', () => {
    expect(labelSpot([0, -200, 0], camera(), 800, 400)).toBeNull();
    expect(labelSpot([90, 0, 0], camera(), 800, 400)).toBeNull();
    expect(labelSpot([0, 0, 40], camera(), 800, 400)).toBeNull();
  });
});
