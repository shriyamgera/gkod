// Puts a tool (a hole, a standoff) at every spot of a pattern on a face.
import type { Spots } from '../features.ts';
import type { Face } from '../model.ts';
import { add, cylinder, each, type Expr, half, mul, type Node, ref, rotate, sub, translate } from '../scad.ts';

const AXES = { x: 0, y: 1, z: 2 } as const;

/** The rotation that turns a tool built along +z to run along the face's normal. */
export const TURN: Record<Face['normal'], Expr[]> = { z: [0, 0, 0], y: [-90, 0, 0], x: [0, 90, 0] };

export function shift(at: Expr[], axis: Face['normal'], by: Expr): Expr[] {
  return at.map((part, i) => (i === AXES[axis] ? add(part, by) : part));
}

export function placeAll(spots: Spots, face: Face, tool: (at: Expr[]) => Node): Node {
  if (spots.kind === 'row') {
    const u = add(spots.start, mul(ref('i'), spots.gap));
    return each([['i', { from: 0, to: sub(spots.count, 1) }]], tool(face.at(u, spots.v)));
  }
  const loops: [string, Expr[]][] = [];
  const u = spots.us.length > 1 ? ref(face.uAxis) : spots.us[0]!;
  const v = spots.vs.length > 1 ? ref(face.vAxis) : spots.vs[0]!;
  if (spots.us.length > 1) loops.push([face.uAxis, spots.us]);
  if (spots.vs.length > 1) loops.push([face.vAxis, spots.vs]);
  const node = tool(face.at(u, v));
  return loops.length ? each(loops, node) : node;
}

/** A hole through the face's material, with a countersink on the face side when asked. */
export function holeTool(face: Face, d: Expr, countersink: boolean, depth: Expr = face.thick): (at: Expr[]) => Node {
  const turn = TURN[face.normal];
  const shaft = cylinder({ d, h: add(depth, 2) });
  if (!countersink) return (at) => translate(shift(at, face.normal, -1), rotate(turn, shaft));
  const parts = [translate([0, 0, -1], shaft), translate([0, 0, sub(depth, half(d))], cylinder({ d1: d, d2: mul(2, d), h: add(half(d), 0.01) }))];
  return (at) => (face.normal === 'z' ? translate(at, ...parts) : translate(at, { name: 'rotate', args: [turn], kids: parts }));
}
