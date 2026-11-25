import { PerspectiveCamera, Vector3 } from 'three';
import type { Bounds } from './grid';

// Looking from the front right and a little above, like OpenSCAD's own start view.
const START_DIRECTION = new Vector3(0.62, -1, 0.56).normalize();
const Z_UP = new Vector3(0, 0, 1);
// Share of the picture the framed box may fill, across and up.
const FILL = 0.88;
const MIN_POLAR = 0.02;

export function centreOf(bounds: Bounds): Vector3 {
  return new Vector3(
    (bounds.min[0] + bounds.max[0]) / 2,
    (bounds.min[1] + bounds.max[1]) / 2,
    (bounds.min[2] + bounds.max[2]) / 2,
  );
}

export function radiusOf(bounds: Bounds): number {
  const dx = bounds.max[0] - bounds.min[0];
  const dy = bounds.max[1] - bounds.min[1];
  const dz = bounds.max[2] - bounds.min[2];
  return Math.max(Math.hypot(dx, dy, dz) / 2, 0.5);
}

/**
 * Places the camera on the start view so the whole box fills most of the picture,
 * and returns the point it looks at.
 */
export function frame(camera: PerspectiveCamera, bounds: Bounds): Vector3 {
  const target = centreOf(bounds);
  const back = START_DIRECTION;
  const right = new Vector3().crossVectors(Z_UP, back).normalize();
  const up = new Vector3().crossVectors(back, right);
  const tanUp = Math.tan((camera.fov * Math.PI) / 360) * FILL;
  const tanAcross = tanUp * camera.aspect;

  // For each corner, the distance at which it just touches the edge of the picture.
  const corners = cornersOf(bounds).map((corner) => corner.sub(target));
  let distance = 0;
  for (const c of corners) {
    const depth = c.dot(back);
    distance = Math.max(
      distance,
      depth + Math.abs(c.dot(right)) / tanAcross,
      depth + Math.abs(c.dot(up)) / tanUp,
    );
  }

  // Perspective makes near corners look bigger, so shift the aim to put the box in the middle.
  let left = Infinity;
  let rightmost = -Infinity;
  let low = Infinity;
  let high = -Infinity;
  for (const c of corners) {
    const depth = distance - c.dot(back);
    const x = c.dot(right) / depth;
    const y = c.dot(up) / depth;
    left = Math.min(left, x);
    rightmost = Math.max(rightmost, x);
    low = Math.min(low, y);
    high = Math.max(high, y);
  }
  target
    .addScaledVector(right, ((left + rightmost) / 2) * distance)
    .addScaledVector(up, ((low + high) / 2) * distance);

  camera.position.copy(target).addScaledVector(back, distance);
  camera.lookAt(target);
  setClipRange(camera, bounds);
  return target;
}

export function setClipRange(camera: PerspectiveCamera, bounds: Bounds) {
  const reach = camera.position.distanceTo(centreOf(bounds)) + radiusOf(bounds) * 4;
  camera.near = reach / 2000;
  camera.far = reach * 20;
  camera.updateProjectionMatrix();
}

/** True when every corner of the box is inside the picture. */
export function fits(camera: PerspectiveCamera, bounds: Bounds): boolean {
  camera.updateMatrixWorld();
  for (const corner of cornersOf(bounds)) {
    const behind = corner.clone().applyMatrix4(camera.matrixWorldInverse).z > -camera.near;
    corner.project(camera);
    if (behind || Math.abs(corner.x) > 1 || Math.abs(corner.y) > 1) return false;
  }
  return true;
}

/** Turns the camera around the target, with Z as the up direction. Angles in radians. */
export function orbitBy(camera: PerspectiveCamera, target: Vector3, around: number, over: number) {
  const offset = camera.position.clone().sub(target);
  const distance = offset.length();
  const azimuth = Math.atan2(offset.y, offset.x) + around;
  const polar = clamp(Math.acos(clamp(offset.z / distance, -1, 1)) + over, MIN_POLAR, Math.PI - MIN_POLAR);
  camera.position.set(
    target.x + distance * Math.sin(polar) * Math.cos(azimuth),
    target.y + distance * Math.sin(polar) * Math.sin(azimuth),
    target.z + distance * Math.cos(polar),
  );
  camera.lookAt(target);
}

/** Moves the camera towards (factor below 1) or away from the target, within limits. */
export function zoomBy(camera: PerspectiveCamera, target: Vector3, factor: number, min: number, max: number) {
  const offset = camera.position.clone().sub(target);
  const distance = clamp(offset.length() * factor, min, max);
  camera.position.copy(target).add(offset.setLength(distance));
}

function cornersOf(bounds: Bounds): Vector3[] {
  const corners: Vector3[] = [];
  for (let i = 0; i < 8; i++) {
    corners.push(
      new Vector3(
        i & 1 ? bounds.max[0] : bounds.min[0],
        i & 2 ? bounds.max[1] : bounds.min[1],
        i & 4 ? bounds.max[2] : bounds.min[2],
      ),
    );
  }
  return corners;
}

function clamp(value: number, low: number, high: number): number {
  return Math.min(high, Math.max(low, value));
}
