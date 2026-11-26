import { plural } from '#checks/format';
import { ZERO_VOLUME_MM3 } from '#checks/limits';
import type { Mesh } from '#checks/mesh';
import type { CheckResult } from '#checks/types';

const title = 'Solid, no holes';
const fix =
  'Change the design so it is one closed solid: no gaps in the surface, no pieces that touch only along an edge, ' +
  'and every face pointing outwards; keep every named size.';

// Closed: every edge is shared by exactly two triangles that run along it in opposite directions,
// and the enclosed volume is above zero.
export function checkClosed(mesh: Mesh, volume: number): CheckResult {
  if (mesh.triangles === 0) return failed('There is no shape: the file has no triangles.');
  let open = 0;
  let crowded = 0;
  let flipped = 0;
  const { faces, turn } = mesh.edges;
  for (let e = 0; e < faces.length; e++) {
    const count = faces[e]!;
    if (count === 1) open++;
    else if (count > 2) crowded++;
    else if (turn[e] !== 0) flipped++;
  }
  if (open > 0) {
    return failed(`The surface has gaps, so it is not a closed solid (${plural(open, 'open edge')}).`);
  }
  if (crowded > 0) {
    return failed(
      `Some edges are shared by more than two faces, as when two pieces touch only along an edge (${plural(crowded, 'edge')}).`,
    );
  }
  if (flipped > 0) {
    return failed(`Some faces are turned inside out (${plural(flipped, 'edge')} where neighbouring faces disagree).`);
  }
  if (volume < -ZERO_VOLUME_MM3) return failed('The shape is inside out: all of its faces point inwards.');
  if (volume <= ZERO_VOLUME_MM3) return failed('The shape has no volume, so there is nothing solid to print.');
  return { id: 'closed', ok: true, title, detail: 'The surface is closed, so the slicer can tell inside from outside.' };
}

function failed(detail: string): CheckResult {
  return { id: 'closed', ok: false, title, detail, fix };
}
