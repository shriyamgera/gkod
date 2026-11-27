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
          // up to a block deep enough for battery sockets
          size(at('thickness'), body.thickness, 'thickness', 'Plate thickness (mm)', 0.5, W, 40),
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
      const back = ref('back_height');
      const reach = ref('reach');
      const tip = ref('tip_height');
      const t = ref('thickness');
      // screws go above the tip and the rounded inside corner, where a screwdriver can reach them
      const start = add(max(tip, add(t, ref('fillet'))), 1);
      return {
        sizes: [
          size(at('width'), body.width, 'width', 'Width, side to side on the wall (mm)', 1, 8, 100),
          size(at('plate'), body.plate, 'back_height', 'Back height, against the wall (mm)', 1, 30, P),
          size(at('reach'), body.reach, 'reach', 'Depth from the wall to the front of the tip (mm)', 1, 8, 100),
          size(at('tip'), body.tip, 'tip_height', 'Tip height, from the bottom (mm)', 1, 4, 60),
          size(at('thickness'), body.thickness, 'thickness', 'Thickness of the back, arm and tip (mm)', 0.5, 3, 15),
        ],
        derived: [
          // the room between the back and the tip
          { name: 'gap', value: sub(reach, mul(2, t)) },
          { name: 'fillet', value: div(ref('gap'), 3) },
          { name: 'bevel', value: half(t) },
        ],
        rules: [
          ge(tip, add(t, 2), 'The tip is not taller than the arm.'),
          ge(back, add(start, 12), 'The back is too short to hold a screw above the hook.'),
          ge(ref('gap'), t, 'The room between the back and the tip is less than the thickness.'),
        ],
        shapes: none,
        extent: { x: reach, y: back, z: w },
        faces: {
          plate: {
            u0: start, u1: back, v0: 0, v1: w, uMid: half(add(start, back)), vMid: half(w), uLen: sub(back, start), thick: t,
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
    case 'disc': {
      const dia = ref('diameter');
      return {
        sizes: [
          size(at('diameter'), body.diameter, 'diameter', 'Diameter (mm)', 1, 10, P),
          size(at('thickness'), body.thickness, 'thickness', 'Thickness (mm)', 0.5, W, 20),
        ],
        derived: [],
        rules: [],
        shapes: none,
        extent: { x: dia, y: dia, z: ref('thickness') },
        faces: {},
      };
    }
    case 'saddle': {
      const pipe = ref('pipe_d');
      const t = ref('thickness');
      const outer = ref('outer_r');
      const span = ref('span');
      return {
        sizes: [
          size(at('pipe'), body.pipe, 'pipe_d', 'Pipe diameter (mm)', 0.5, 4, 120),
          size(at('thickness'), body.thickness, 'thickness', 'Strap thickness (mm)', 0.5, 2, 10),
          size(at('foot'), body.foot, 'foot_length', 'Foot length, each side (mm)', 1, 6, 60),
          size(at('width'), body.width, 'width', 'Strap width, along the pipe (mm)', 1, 6, 100),
        ],
        derived: [
          { name: 'outer_r', value: add(half(pipe), t) },
          // from the end of one foot to the end of the other
          { name: 'span', value: mul(2, add(outer, ref('foot_length'))) },
        ],
        rules: [],
        // the strap stands up from the wall between the feet; screws go through the feet only
        shapes: (env) => [{ face: 'feet', cut: false, edge: true, what: 'pipe strap', u0: -env.outer_r!, v0: 0, u1: env.outer_r!, v1: env.width! }],
        extent: { x: span, y: add(pipe, t), z: w },
        faces: {
          feet: {
            u0: half(mul(-1, span)), u1: half(span), v0: 0, v1: w, uMid: 0, vMid: half(w), uLen: span, thick: t,
            at: (u, v) => [u, 0, v], normal: 'y', uAxis: 'x', vAxis: 'z', flat: false,
          },
        },
      };
    }
    case 'handle': {
      const spacing = ref('hole_spacing');
      const len = ref('length');
      const h = ref('height');
      const grip = ref('grip');
      const post = ref('post');
      const screw = ref('screw_d');
      return {
        sizes: [
          size(at('spacing'), body.spacing, 'hole_spacing', 'Distance between the screw holes (mm)', 1, 16, 190),
          size(at('length'), body.length, 'length', 'Handle length, end to end (mm)', 1, 30, P),
          size(at('height'), body.height, 'height', 'Height out from the drawer (mm)', 1, 12, 80),
          size(at('grip'), body.grip, 'grip', 'Grip bar thickness (mm)', 0.5, 5, 20),
          size(at('post'), body.post, 'post', 'Post width (mm)', 0.5, 6, 30),
          size(at('width'), body.width, 'width', 'Bar width (mm)', 1, 8, 40),
          size(at('screw'), body.screw, 'screw_d', 'Screw hole diameter (mm)', 0.5, LIMITS.holeMin, LIMITS.sideHoleMax),
          size(at('screwDepth'), body.screwDepth, 'screw_depth', 'Screw hole depth (mm)', 0.5, 4, 40),
        ],
        derived: [],
        rules: [
          ge(len, add(add(spacing, post), grip), 'The posts stick out past the ends of the bar.'),
          ge(sub(spacing, post), 30, 'There is no room for a hand between the posts.'),
          ge(sub(h, grip), 14, 'There is no room for fingers under the bar.'),
          ge(post, add(screw, 2 * W), 'The posts are too thin for their screw holes.'),
          ge(w, add(screw, 2 * W), 'The bar is too narrow for its screw holes.'),
          le(ref('screw_depth'), sub(h, 2), 'The screw holes go through the top of the handle.'),
        ],
        shapes: none,
        extent: { x: len, y: h, z: w },
        faces: {},
      };
    }
    case 'foot': {
      const dia = ref('diameter');
      const top = ref('top_d');
      const h = ref('height');
      return {
        sizes: [
          size(at('diameter'), body.diameter, 'diameter', 'Base diameter (mm)', 1, 8, 120),
          size(at('top'), body.top, 'top_d', 'Top diameter (mm)', 1, 6, 120),
          size(at('height'), body.height, 'height', 'Height (mm)', 0.5, 2, 60),
        ],
        derived: [],
        rules: [
          le(top, dia, 'The top is wider than the base.'),
          le(h, dia, 'The foot is taller than it is wide.'),
        ],
        shapes: none,
        extent: { x: dia, y: dia, z: h },
        faces: {
          // a screw hole goes down the middle; the box around the top circle is close enough for one centre hole
          top: {
            u0: half(mul(-1, top)), u1: half(top), v0: half(mul(-1, top)), v1: half(top), uMid: 0, vMid: 0, uLen: top, thick: h,
            at: (u, v) => [u, v, 0], normal: 'z', uAxis: 'x', vAxis: 'y', flat: true,
          },
        },
      };
    }
    case 'sleeve': {
      const dia = ref('diameter');
      return {
        sizes: [
          size(at('diameter'), body.diameter, 'diameter', 'Outer diameter, to fit the hole (mm)', 0.5, 10, P),
          size(at('wall'), body.wall, 'wall', 'Wall thickness (mm)', 0.2, W, 10),
          size(at('height'), body.height, 'height', 'Height (mm)', 0.5, 4, 100),
        ],
        derived: [{ name: 'inner_d', value: sub(dia, mul(2, ref('wall'))) }],
        rules: [ge(ref('inner_d'), 6, 'The opening is narrower than 6 mm.')],
        shapes: none,
        extent: { x: dia, y: dia, z: ref('height') },
        faces: {},
      };
    }
    case 'cup': {
      const dia = ref('diameter');
      const wall = ref('wall');
      const f = ref('floor_thickness');
      const n = body.sides;
      // the wall is measured across a flat, so a corner of the inside sits farther out than the wall
      const inner = n ? sub(dia, div(mul(2, wall), cos(180 / n))) : sub(dia, mul(2, wall));
      // holes in the floor stay inside the square that fits in the floor's inner circle
      const flatR = n ? mul(half(ref('inner_d')), cos(180 / n)) : half(ref('inner_d'));
      const box = div(flatR, 1.4142);
      return {
        sizes: [
          size(at('diameter'), body.diameter, 'diameter', n ? 'Width across the corners (mm)' : 'Outer diameter (mm)', 1, 20, P),
          size(at('height'), body.height, 'height', 'Height (mm)', 1, 10, P),
          size(at('wall'), body.wall, 'wall', 'Wall thickness (mm)', 0.2, W, 10),
          size(at('floor'), body.floor, 'floor_thickness', 'Floor thickness (mm)', 0.2, W, 10),
        ],
        derived: [{ name: 'inner_d', value: inner }],
        rules: [
          ge(ref('inner_d'), 10, 'The inside is narrower than 10 mm.'),
          ge(ref('height'), add(f, 5), 'The cup is not deeper than its floor.'),
        ],
        shapes: none,
        extent: { x: dia, y: n === 6 ? mul(dia, cos(30)) : dia, z: ref('height') },
        faces: {
          floor: {
            u0: mul(-1, box), u1: box, v0: mul(-1, box), v1: box, uMid: 0, vMid: 0, uLen: mul(2, box), thick: f,
            at: (u, v) => [u, v, 0], normal: 'z', uAxis: 'x', vAxis: 'y', flat: true,
          },
        },
      };
    }
    case 'comb': {
      const d = ref('depth');
      const slotDepth = ref('slot_depth');
      return {
        sizes: [
          size(at('width'), body.width, 'width', 'Comb width (mm)', 1, 20, P),
          size(at('depth'), body.depth, 'depth', 'Depth, front to back (mm)', 1, 15, P),
          size(at('thickness'), body.thickness, 'thickness', 'Thickness (mm)', 0.5, W, 20),
          size(at('slots'), body.slots, 'slot_count', 'Number of cable slots', 1, 2, 20),
          size(at('slot'), body.slot, 'slot_width', 'Slot width, for the cable (mm)', 0.5, 2, 20),
          size(at('slotDepth'), body.slotDepth, 'slot_depth', 'Slot depth, in from the front edge (mm)', 0.5, 3, 150),
        ],
        derived: [{ name: 'slot_pitch', value: div(w, ref('slot_count')) }],
        rules: [
          ge(sub(ref('slot_pitch'), ref('slot_width')), 4, 'The fingers between the slots are thinner than 4 mm.'),
          ge(slotDepth, ref('slot_width'), 'A slot is shallower than it is wide.'),
          ge(sub(d, slotDepth), 8, 'The slots cut too far into the comb.'),
        ],
        shapes: none,
        extent: { x: w, y: d, z: ref('thickness') },
        faces: {
          // the solid strip behind the slots, where the screws go
          spine: {
            u0: 0, u1: w, v0: slotDepth, v1: d, uMid: half(w), vMid: half(add(slotDepth, d)), uLen: w, thick: ref('thickness'),
            at: (u, v) => [u, v, 0], normal: 'z', uAxis: 'x', vAxis: 'y', flat: true,
          },
        },
      };
    }
    case 'corner': {
      const len = ref('length');
      const arm = ref('arm_width');
      const t = ref('thickness');
      // each arm carries holes from just past the square where the arms meet out to its end
      const start = add(arm, W);
      const face = (at: Face['at'], uAxis: 'x' | 'y', vAxis: 'x' | 'y'): Face => ({
        u0: start, u1: len, v0: 0, v1: arm, uMid: half(add(start, len)), vMid: half(arm), uLen: sub(len, start), thick: t,
        at, normal: 'z', uAxis, vAxis, flat: true,
      });
      return {
        sizes: [
          size(at('length'), body.length, 'length', 'Arm length, from the outside corner (mm)', 1, 20, P),
          size(at('arm'), body.arm, 'arm_width', 'Arm width (mm)', 1, 8, 60),
          size(at('thickness'), body.thickness, 'thickness', 'Plate thickness (mm)', 0.5, W, 15),
        ],
        derived: [{ name: 'fillet', value: half(arm) }],
        rules: [ge(len, add(arm, 10), 'The arms are too short for their width.')],
        shapes: none,
        extent: { x: len, y: len, z: t },
        faces: {
          arm1: face((u, v) => [u, v, 0], 'x', 'y'),
          arm2: face((u, v) => [v, u, 0], 'y', 'x'),
        },
      };
    }
  }
}
