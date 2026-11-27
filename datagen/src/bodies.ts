// The named sizes, faces and rules of each base body.
import { type Face, ge, le, type Piece, type Rule, type Size, size } from './model.ts';
import { add, cos, div, half, max, mul, ref, sub } from './scad.ts';
import { type Body, LIMITS } from './tree.ts';

export type BodyPiece = Piece & { faces: Record<string, Face> };

const P = LIMITS.part;
const W = LIMITS.wall;

const at = (field: string): (string | number)[] => ['body', field];

function cornerSize(body: Extract<Body, { corner: unknown }>): Size[] {
  if (body.corner === 'round') return [size(at('cornerSize'), body.cornerSize, 'corner_r', 'Corner radius (mm)', 0.5, 1, 30)];
  if (body.corner === 'chamfer') return [size(at('cornerSize'), body.cornerSize, 'chamfer', 'Corner chamfer (mm)', 0.5, 1, 30)];
  return [];
}

/** The size name of a rounded or chamfered corner, or 0 for a sharp one. */
export function cornerRef(body: Extract<Body, { corner: unknown }>) {
  if (body.corner === 'round') return ref('corner_r');
  if (body.corner === 'chamfer') return ref('chamfer');
  return 0;
}

function cornerRules(body: Extract<Body, { corner: unknown }>): Rule[] {
  const c = cornerRef(body);
  if (c === 0) return [];
  return [
    ge(ref('width'), add(mul(2, c), 4), 'The corners are too big for the width.'),
    ge(ref('depth'), add(mul(2, c), 4), 'The corners are too big for the depth.'),
  ];
}

const none = () => [];

export function bodyPiece(body: Body): BodyPiece {
  const w = ref('width');
  switch (body.kind) {
    case 'plate': {
      const d = ref('depth');
      const t = ref('thickness');
      const c = cornerRef(body);
      return {
        sizes: [
          size(at('width'), body.width, 'width', 'Plate width (mm)', 1, 10, P),
          size(at('depth'), body.depth, 'depth', 'Plate depth, front to back (mm)', 1, 10, P),
          size(at('thickness'), body.thickness, 'thickness', 'Plate thickness (mm)', 0.5, W, 20),
          ...cornerSize(body),
        ],
        derived: [],
        rules: cornerRules(body),
        shapes: none,
        extent: { x: w, y: d, z: t },
        faces: {
          top: {
            u0: 0, u1: w, v0: 0, v1: d, uMid: half(w), vMid: half(d), uLen: w, thick: t,
            at: (u, v) => [u, v, 0], normal: 'z', uAxis: 'x', vAxis: 'y', flat: true,
            corner: body.corner === 'sharp' ? undefined : { kind: body.corner, size: c },
          },
        },
      };
    }
    case 'box': {
      const d = ref('depth');
      const h = ref('height');
      const wall = ref('wall');
      const f = ref('floor_thickness');
      const c = cornerRef(body);
      const inner = body.corner === 'round' ? max(sub(c, wall), 0) : max(sub(c, mul(0.8284, wall)), 0);
      return {
        sizes: [
          size(at('width'), body.width, 'width', 'Box width (mm)', 1, 10, P),
          size(at('depth'), body.depth, 'depth', 'Box depth, front to back (mm)', 1, 10, P),
          size(at('height'), body.height, 'height', 'Box height (mm)', 1, 5, P),
          size(at('wall'), body.wall, 'wall', 'Wall thickness (mm)', 0.2, W, 10),
          size(at('floor'), body.floor, 'floor_thickness', 'Floor thickness (mm)', 0.2, W, 10),
          ...cornerSize(body),
        ],
        derived: [],
        rules: [
          ...cornerRules(body),
          ge(w, add(mul(2, wall), 6), 'The box is too narrow for its walls.'),
          ge(d, add(mul(2, wall), 6), 'The box is too shallow front to back for its walls.'),
          ge(h, add(f, 2), 'The box is not deeper than its floor.'),
        ],
        shapes: none,
        extent: { x: w, y: d, z: h },
        faces: {
          floor: {
            u0: wall, u1: sub(w, wall), v0: wall, v1: sub(d, wall), uMid: half(w), vMid: half(d), uLen: sub(w, mul(2, wall)), thick: f,
            at: (u, v) => [u, v, 0], normal: 'z', uAxis: 'x', vAxis: 'y', flat: true,
            corner: body.corner === 'sharp' ? undefined : { kind: body.corner, size: inner },
          },
        },
      };
    }
    case 'angle': {
      const b = ref('base_length');
      const h = ref('height');
      const t = ref('thickness');
      return {
        sizes: [
          size(at('width'), body.width, 'width', 'Bracket width (mm)', 1, 8, P),
          size(at('base'), body.base, 'base_length', 'Base leg length (mm)', 1, 10, P),
          size(at('height'), body.height, 'height', 'Upright leg height (mm)', 1, 10, P),
          size(at('thickness'), body.thickness, 'thickness', 'Material thickness (mm)', 0.5, 2, 15),
        ],
        derived: [],
        rules: [
          ge(b, add(t, 6), 'The base leg is too short for the thickness.'),
          ge(h, add(t, 6), 'The upright leg is too short for the thickness.'),
        ],
        shapes: none,
        extent: { x: w, y: b, z: h },
        faces: {
          base: {
            u0: 0, u1: w, v0: t, v1: b, uMid: half(w), vMid: half(add(b, t)), uLen: w, thick: t,
            at: (u, v) => [u, v, 0], normal: 'z', uAxis: 'x', vAxis: 'y', flat: true,
          },
          upright: {
            u0: 0, u1: w, v0: t, v1: h, uMid: half(w), vMid: half(add(h, t)), uLen: w, thick: t,
            at: (u, v) => [u, 0, v], normal: 'y', uAxis: 'x', vAxis: 'z', flat: false,
          },
        },
      };
    }
    case 'channel': {
      const len = ref('length');
      const h = ref('height');
      const wall = ref('wall');
      const f = ref('floor_thickness');
      return {
        sizes: [
          size(at('width'), body.width, 'width', 'Outer width (mm)', 1, 10, P),
          size(at('length'), body.length, 'length', 'Length (mm)', 1, 10, P),
          size(at('height'), body.height, 'height', 'Outer height (mm)', 1, 5, P),
          size(at('wall'), body.wall, 'wall', 'Wall thickness (mm)', 0.2, W, 10),
          size(at('floor'), body.floor, 'floor_thickness', 'Floor thickness (mm)', 0.2, W, 10),
        ],
        derived: [],
        rules: [
          ge(w, add(mul(2, wall), 4), 'The channel is too narrow for its walls.'),
          ge(h, add(f, 2), 'The walls are not taller than the floor.'),
        ],
        shapes: none,
        extent: { x: w, y: len, z: h },
        faces: {
          floor: {
            u0: 0, u1: len, v0: wall, v1: sub(w, wall), uMid: half(len), vMid: half(w), uLen: len, thick: f,
            at: (u, v) => [v, u, 0], normal: 'z', uAxis: 'y', vAxis: 'x', flat: true,
          },
        },
      };
    }
    case 'round': {
      const h = ref('height');
      const bore = ref('bore_d');
      const outer = body.hex ? ref('across_flats') : ref('diameter');
      const across = body.hex ? div(outer, cos(30)) : outer;
      return {
        sizes: [
          body.hex
            ? size(at('diameter'), body.diameter, 'across_flats', 'Width across flats (mm)', 0.5, 4, P)
            : size(at('diameter'), body.diameter, 'diameter', 'Outer diameter (mm)', 0.5, 4, P),
          size(at('height'), body.height, 'height', 'Height (mm)', 0.5, 1, P),
          size(at('bore'), body.bore, 'bore_d', 'Hole diameter (mm)', 0.5, LIMITS.holeMin, LIMITS.holeMax),
        ],
        derived: [],
        rules: [ge(sub(outer, bore), 2 * W, 'The wall around the hole is too thin.')],
        shapes: none,
        extent: { x: across, y: outer, z: h },
        faces: {},
      };
    }
    case 'hook': {
      const plate = ref('plate_height');
      const reach = ref('reach');
      const tip = ref('tip');
      const t = ref('thickness');
      const fillet = ref('fillet');
      const start = add(max(tip, add(t, fillet)), 1);
      return {
        sizes: [
          size(at('width'), body.width, 'width', 'Hook width (mm)', 1, 8, 100),
          size(at('plate'), body.plate, 'plate_height', 'Back plate height (mm)', 1, 30, P),
          size(at('reach'), body.reach, 'reach', 'How far the hook reaches out (mm)', 1, 8, 100),
          size(at('tip'), body.tip, 'tip', 'Tip height (mm)', 1, 4, 60),
          size(at('thickness'), body.thickness, 'thickness', 'Material thickness (mm)', 0.5, 3, 15),
        ],
        derived: [
          { name: 'arm_length', value: add(reach, mul(2, t)) },
          { name: 'fillet', value: mul(reach, 0.4) },
        ],
        rules: [
          ge(tip, add(t, 2), 'The tip is not taller than the arm.'),
          ge(plate, add(start, 12), 'The back plate is too short to hold a screw above the hook.'),
          ge(reach, t, 'The hook reaches out less than its thickness.'),
        ],
        shapes: none,
        extent: { x: ref('arm_length'), y: plate, z: w },
        faces: {
          plate: {
            u0: start, u1: plate, v0: 0, v1: w, uMid: half(add(start, plate)), vMid: half(w), uLen: sub(plate, start), thick: t,
            at: (u, v) => [0, u, v], normal: 'x', uAxis: 'y', vAxis: 'z', flat: false,
          },
        },
      };
    }
    case 'knob': {
      const dia = ref('diameter');
      const h = ref('height');
      const shaft = ref('shaft_d');
      const depth = ref('shaft_depth');
      const ch = ref('chamfer');
      return {
        sizes: [
          size(at('diameter'), body.diameter, 'diameter', 'Knob diameter (mm)', 1, 10, 120),
          size(at('height'), body.height, 'height', 'Knob height (mm)', 0.5, 6, 60),
          size(at('shaft'), body.shaft, 'shaft_d', 'Shaft hole diameter (mm)', 0.5, LIMITS.holeMin, LIMITS.holeMax),
          size(at('shaftDepth'), body.shaftDepth, 'shaft_depth', 'Shaft hole depth (mm)', 0.5, 3, 60),
          size(at('chamfer'), body.chamfer, 'chamfer', 'Edge chamfer (mm)', 0.5, 0.5, 5),
        ],
        derived: [],
        rules: [
          le(depth, sub(h, W), 'The shaft hole goes through the face of the knob.'),
          ge(sub(half(dia), half(shaft)), 3, 'The knob is too small around the shaft hole.'),
          le(ch, div(h, 3), 'The chamfer is too big for the knob height.'),
          le(ch, div(dia, 6), 'The chamfer is too big for the knob diameter.'),
        ],
        shapes: none,
        extent: { x: dia, y: dia, z: h },
        faces: {},
      };
    }
    case 'clip': {
      const cable = ref('cable_d');
      const snap = ref('snap');
      const len = ref('length');
      const base = ref('base_width');
      const outer = ref('outer_d');
      return {
        sizes: [
          size(at('cable'), body.cable, 'cable_d', 'Diameter of the cable or pipe it holds (mm)', 0.5, 3, 40),
          size(at('wall'), body.wall, 'ring_wall', 'Wall around the cable (mm)', 0.2, W, 6),
          size(at('grip'), body.grip, 'snap', 'Opening narrower than the cable by (mm)', 0.5, 0.5, 6),
          size(at('length'), body.length, 'length', 'Length along the cable (mm)', 1, 5, 100),
          size(at('pad'), body.pad, 'base_width', 'Base width (mm)', 1, 8, 150),
          size(at('padThickness'), body.padThickness, 'base_thickness', 'Base thickness (mm)', 0.5, W, 10),
        ],
        derived: [
          { name: 'outer_d', value: add(cable, mul(2, ref('ring_wall'))) },
          { name: 'opening', value: sub(cable, snap) },
          // the cable rests one wall above the base
          { name: 'center_y', value: add(add(ref('base_thickness'), ref('ring_wall')), half(cable)) },
        ],
        rules: [
          le(snap, half(cable), 'The opening is less than half the cable, so the cable cannot go in.'),
          ge(base, outer, 'The base is narrower than the part that holds the cable.'),
        ],
        shapes: (env) => [
          { face: 'pad', cut: false, edge: true, what: 'cable holder', u0: -env.outer_d! / 2, v0: 0, u1: env.outer_d! / 2, v1: env.length! },
        ],
        extent: { x: base, y: add(ref('center_y'), half(outer)), z: len },
        trims: ['y'],
        faces: {
          pad: {
            u0: half(mul(-1, base)), u1: half(base), v0: 0, v1: len, uMid: 0, vMid: half(len), uLen: base, thick: ref('base_thickness'),
            at: (u, v) => [u, 0, v], normal: 'y', uAxis: 'x', vAxis: 'z', flat: false,
          },
        },
      };
    }
  }
}
