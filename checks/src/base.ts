import { mm2 } from '#checks/format';
import { BED_LAYER_MM, MIN_CONTACT_MM2, MIN_CONTACT_SHARE, POINT_CONTACT_MM2, SMALL_PART_SHARE } from '#checks/limits';
import type { Mesh } from '#checks/mesh';
import type { CheckResult } from '#checks/types';

const title = 'Sits flat on the bed';

/**
 * Marks the triangles that rest on the bed: facing down and lying within the lowest layer.
 * The slicer drops a part onto the bed, so the lowest point counts as the bed, wherever it is.
 */
export function bedFaces(mesh: Mesh): Uint8Array {
  const onBed = new Uint8Array(mesh.triangles);
  const top = mesh.min[2] + BED_LAYER_MM;
  const p = mesh.positions;
  for (let t = 0; t < mesh.triangles; t++) {
    const o = t * 9;
    if (mesh.normals[t * 3 + 2]! < 0 && p[o + 2]! <= top && p[o + 5]! <= top && p[o + 8]! <= top) onBed[t] = 1;
  }
  return onBed;
}

export function checkBase(mesh: Mesh, onBed: Uint8Array): CheckResult {
  let contact = 0;
  for (let t = 0; t < mesh.triangles; t++) {
    if (onBed[t]) contact -= mesh.areas[t]! * mesh.normals[t * 3 + 2]!;
  }
  const footprint = (mesh.max[0] - mesh.min[0]) * (mesh.max[1] - mesh.min[1]);
  const needed = Math.max(MIN_CONTACT_SHARE * footprint, Math.min(MIN_CONTACT_MM2, SMALL_PART_SHARE * footprint));
  if (contact > 0 && contact >= needed) {
    return { id: 'flat-base', ok: true, title, detail: `About ${mm2(contact)} mm² rests flat on the bed.` };
  }
  const detail =
    contact < POINT_CONTACT_MM2
      ? 'It only touches the bed at a point or along an edge, so it would tip over or come loose while printing.'
      : `Only about ${mm2(contact)} mm² rests flat on the bed; it needs at least ${mm2(needed)} mm² to stay put while printing.`;
  return {
    id: 'flat-base',
    ok: false,
    title,
    detail,
    fix:
      `Change the design so a flat face of at least ${mm2(needed)} mm² rests on the bed at its lowest point ` +
      '(for example, flatten the bottom or add a base); keep every named size.',
  };
}
