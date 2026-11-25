import type { Vec3 } from './stl';

export type Bounds = { min: Vec3; max: Vec3 };

export const GRID_MM = 10;
const MARGIN_MM = 10;

/** The patch of print bed drawn under the part, on whole grid lines so it stays put when a size changes. */
export function bedArea(part: Bounds): Bounds {
  const z = part.min[2];
  return {
    min: [snapDown(part.min[0] - MARGIN_MM), snapDown(part.min[1] - MARGIN_MM), z],
    max: [snapUp(part.max[0] + MARGIN_MM), snapUp(part.max[1] + MARGIN_MM), z],
  };
}

/** The part together with its patch of bed: what the camera frames. */
export function sceneBounds(part: Bounds): Bounds {
  const bed = bedArea(part);
  return {
    min: [bed.min[0], bed.min[1], part.min[2]],
    max: [bed.max[0], bed.max[1], part.max[2]],
  };
}

function snapDown(value: number): number {
  return Math.floor(value / GRID_MM) * GRID_MM;
}

function snapUp(value: number): number {
  return Math.ceil(value / GRID_MM) * GRID_MM;
}
