export type Vec3 = [number, number, number];
export type View = 'iso' | 'front' | 'side' | 'top';
export const VIEWS: View[] = ['iso', 'front', 'side', 'top'];

/** Screen directions in model space: right and up on the picture, and back towards the camera. */
export type Basis = { right: Vec3; up: Vec3; back: Vec3 };

export const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
export function normalise(v: Vec3): Vec3 {
  const length = Math.hypot(v[0], v[1], v[2]);
  return [v[0] / length, v[1] / length, v[2] / length];
}

// From the front right and a little above, the start view of the site's viewer.
const ISO_BACK = normalise([0.62, -1, 0.56]);

export function basisFor(view: View): Basis {
  if (view === 'front') return { right: [1, 0, 0], up: [0, 0, 1], back: [0, -1, 0] };
  if (view === 'side') return { right: [0, 1, 0], up: [0, 0, 1], back: [1, 0, 0] };
  if (view === 'top') return { right: [1, 0, 0], up: [0, 1, 0], back: [0, 0, 1] };
  const right = normalise(cross([0, 0, 1], ISO_BACK));
  return { right, up: cross(ISO_BACK, right), back: ISO_BACK };
}

/** Where the model is drawn: pixels per mm, the model point that lands on (centreX, centreY), and the size of what was fitted in mm. */
export type Frame = { scale: number; mid: [number, number]; centreX: number; centreY: number; span: [number, number] };

/**
 * Fits points into a width x height picture, seen along the basis, with `margin` pixels free on every side
 * and `bottom` more pixels free at the bottom.
 */
export function frameFor(points: Vec3[], basis: Basis, width: number, height: number, margin: number, bottom = 0): Frame {
  let minU = Infinity, maxU = -Infinity, minV = Infinity, maxV = -Infinity;
  for (const p of points) {
    const u = dot(p, basis.right), v = dot(p, basis.up);
    minU = Math.min(minU, u);
    maxU = Math.max(maxU, u);
    minV = Math.min(minV, v);
    maxV = Math.max(maxV, v);
  }
  const roomX = width - 2 * margin;
  const roomY = height - 2 * margin - bottom;
  const scale = Math.min(roomX / Math.max(maxU - minU, 1e-6), roomY / Math.max(maxV - minV, 1e-6));
  return {
    scale,
    mid: [(minU + maxU) / 2, (minV + maxV) / 2],
    centreX: width / 2,
    centreY: margin + roomY / 2,
    span: [maxU - minU, maxV - minV],
  };
}

/** Pixel x and y (y grows downwards) and depth (bigger is nearer the camera) of a model point. */
export function toPixel(p: Vec3, basis: Basis, frame: Frame): Vec3 {
  return [
    frame.centreX + (dot(p, basis.right) - frame.mid[0]) * frame.scale,
    frame.centreY - (dot(p, basis.up) - frame.mid[1]) * frame.scale,
    dot(p, basis.back),
  ];
}
