import { BufferAttribute, BufferGeometry, type Camera, Vector3 } from 'three';
import type { Mesh, Vec3 } from './stl';

/** Faces to pick out on the part, with a short label at one point, e.g. where it would sag. */
export type ViewerMark = {
  triangles: readonly number[];
  at?: Vec3;
  // drawn beside the point, e.g. "Would sag here"
  label: string;
  // added to the text summary for screen readers, e.g. "Steep overhang at 30 mm height"
  description: string;
};

export type LabelSpot = { x: number; y: number; side: 'left' | 'right' };

// Room the label needs to the right of its point before it moves to the other side.
const LABEL_ROOM = 150;

/** A geometry holding copies of the marked faces only, or null when none of them is on this mesh. */
export function markGeometry(mesh: Mesh, triangles: readonly number[]): BufferGeometry | null {
  const picked = triangles.filter((t) => Number.isInteger(t) && t >= 0 && t < mesh.triangles);
  if (picked.length === 0) return null;
  const positions = new Float32Array(picked.length * 9);
  picked.forEach((t, i) => positions.set(mesh.positions.subarray(t * 9, t * 9 + 9), i * 9));
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(positions, 3));
  return geometry;
}

/** Where a point lands in a view of the given size, in pixels from the top left, or null if it is out of the picture. */
export function labelSpot(at: Vec3, camera: Camera, width: number, height: number): LabelSpot | null {
  camera.updateMatrixWorld();
  const p = new Vector3(...at).project(camera);
  if (Math.abs(p.x) > 1 || Math.abs(p.y) > 1 || Math.abs(p.z) > 1) return null;
  const x = ((p.x + 1) / 2) * width;
  const y = ((1 - p.y) / 2) * height;
  return { x, y, side: x > width - LABEL_ROOM ? 'left' : 'right' };
}
