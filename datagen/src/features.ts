// The named sizes, rules and footprints of each feature.
import { cornerRef } from './bodies.ts';
import { type Derived, type Face, ge, le, type Path, type Piece, type Shape, type Size, size } from './model.ts';
import { add, cos, div, type Env, evaluate, type Expr, half, max, mul, ref, sin, sub } from './scad.ts';
import { type Body, type Feature, LIMITS, type Place } from './tree.ts';

const W = LIMITS.wall;
const P = LIMITS.part;

export type Ctx = { body: Body; faces: Record<string, Face>; index: number };

/** Prefix for size names and captions: only the bracket has two faces that can both carry holes. */
export function prefixOf(body: Body, face: string): { p: string; label: string } {
  return body.kind === 'angle' ? { p: `${face}_`, label: `${face} ` } : { p: '', label: '' };
}

const cap = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

/** Positions of holes or standoffs: every u with every v, or a row of evenly spaced positions along u. */
export type Spots =
  | { kind: 'grid'; us: Expr[]; vs: Expr[] }
  | { kind: 'row'; count: Expr; start: Expr; gap: Expr; v: Expr };

export function spots(place: Place, face: Face, p: string, stem: string): Spots {
  const n = (field: string) => ref(`${p}${stem}_${field}`);
  switch (place.pattern) {
    case 'center':
      return { kind: 'grid', us: [face.uMid], vs: [face.vMid] };
    case 'pair':
      return { kind: 'grid', us: [sub(face.uMid, half(n('spacing'))), add(face.uMid, half(n('spacing')))], vs: [face.vMid] };
    case 'corners':
      return {
        kind: 'grid',
        us: [add(face.u0, n('inset')), sub(face.u1, n('inset'))],
        vs: [add(face.v0, n('inset')), sub(face.v1, n('inset'))],
      };
    case 'grid':
      return {
        kind: 'grid',
        us: [sub(face.uMid, half(n('spacing_x'))), add(face.uMid, half(n('spacing_x')))],
        vs: [sub(face.vMid, half(n('spacing_y'))), add(face.vMid, half(n('spacing_y')))],
      };
    case 'row':
      return { kind: 'row', count: n('count'), start: add(face.u0, n('inset')), gap: n('gap'), v: face.vMid };
  }
}

export function centers(s: Spots, env: Env): [number, number][] {
  if (s.kind === 'grid') {
    const vs = s.vs.map((v) => evaluate(v, env));
    return s.us.flatMap((u) => vs.map((v): [number, number] => [evaluate(u, env), v]));
  }
  const count = Math.round(evaluate(s.count, env));
  const start = evaluate(s.start, env);
  const gap = evaluate(s.gap, env);
  const v = evaluate(s.v, env);
  return Array.from({ length: count }, (_, i): [number, number] => [start + i * gap, v]);
}

function placeSizes(place: Place, path: Path, face: Face, p: string, label: string, stem: 'hole' | 'boss') {
  const noun = `${label}${stem === 'hole' ? 'hole' : 'standoff'}`;
  const nouns = `${noun}s`;
  const name = (field: string) => `${p}${stem}_${field}`;
  const sizes: Size[] = [];
  const derived: Derived[] = [];
  const at = (field: string) => [...path, 'place', field];
  switch (place.pattern) {
    case 'pair':
      sizes.push(size(at('spacing'), place.spacing, name('spacing'), cap(`distance between ${noun} centres (mm)`), 1, 4, P));
      break;
    case 'corners':
      sizes.push(size(at('inset'), place.inset, name('inset'), cap(`${noun} distance from the edge (mm)`), 0.5, 2, 100));
      break;
    case 'grid':
      sizes.push(size(at('x'), place.x, name('spacing_x'), cap(`${noun} spacing, left to right (mm)`), 1, 4, P));
      sizes.push(size(at('y'), place.y, name('spacing_y'), cap(`${noun} spacing, front to back (mm)`), 1, 4, P));
      break;
    case 'row':
      sizes.push(size(at('count'), place.count, name('count'), cap(`number of ${nouns}`), 1, 2, 12));
      sizes.push(size(at('inset'), place.inset, name('inset'), cap(`${noun} distance from the end (mm)`), 0.5, 2, 100));
      derived.push({ name: name('gap'), value: div(sub(face.uLen, mul(2, ref(name('inset')))), sub(ref(name('count')), 1)) });
      break;
    case 'center':
      break;
  }
  return { sizes, derived };
}

const box = (face: string, cut: boolean, what: string, u0: number, v0: number, u1: number, v1: number, edge = false): Shape => ({
  face, cut, what, edge, u0, v0, u1, v1,
});

export function featurePiece(f: Feature, ctx: Ctx): Piece {
  const path: Path = ['features', ctx.index];
  const at = (field: string) => [...path, field];
  const body = ctx.body;
  switch (f.kind) {
    case 'holes': {
      const face = ctx.faces[f.face]!;
      const { p, label } = prefixOf(body, f.face);
      const d = ref(`${p}hole_d`);
      const placed = placeSizes(f.place, path, face, p, label, 'hole');
      const where = spots(f.place, face, p, 'hole');
      const rules = [];
      if (f.countersink) rules.push(ge(face.thick, add(half(d), 1), 'The material is too thin for countersunk holes this size.'));
      if (!face.flat) rules.push(le(d, LIMITS.sideHoleMax, 'Holes through a standing wall this big would sag at the top.'));
      return {
        sizes: [size(at('d'), f.d, `${p}hole_d`, cap(`${label}hole diameter (mm)`), 0.5, LIMITS.holeMin, LIMITS.holeMax), ...placed.sizes],
        derived: placed.derived,
        rules,
        shapes: (env) => {
          const r = f.countersink ? env[`${p}hole_d`]! : env[`${p}hole_d`]! / 2;
          return centers(where, env).map(([u, v]) => ({ face: f.face, cut: true, what: 'hole', u, v, r }));
        },
        extent: {},
      };
    }
    case 'slots': {
      const face = ctx.faces[f.face]!;
      const { p, label } = prefixOf(body, f.face);
      const sizes = [
        size(at('length'), f.length, `${p}slot_length`, cap(`${label}slot length, end to end (mm)`), 1, 4, 150),
        size(at('width'), f.width, `${p}slot_width`, cap(`${label}slot width (mm)`), 0.5, LIMITS.holeMin, LIMITS.holeMax),
      ];
      if (f.count === 2) sizes.push(size(at('spacing'), f.spacing, `${p}slot_spacing`, cap(`distance between ${label}slots (mm)`), 1, 4, P));
      return {
        sizes,
        derived: [],
        rules: [ge(ref(`${p}slot_length`), add(ref(`${p}slot_width`), 1), 'A slot must be longer than it is wide.')],
        shapes: (env) => {
          const len = env[`${p}slot_length`]!;
          const wid = env[`${p}slot_width`]!;
          const offs = f.count === 2 ? [-env[`${p}slot_spacing`]! / 2, env[`${p}slot_spacing`]! / 2] : [0];
          const um = evaluate(face.uMid, env);
          const vm = evaluate(face.vMid, env);
          return offs.map((o) =>
            f.along === 'u'
              ? box(f.face, true, 'slot', um - len / 2, vm + o - wid / 2, um + len / 2, vm + o + wid / 2)
              : box(f.face, true, 'slot', um + o - wid / 2, vm - len / 2, um + o + wid / 2, vm + len / 2),
          );
        },
        extent: {},
      };
    }
    case 'pocket': {
      const face = ctx.faces[f.face]!;
      return {
        sizes: [
          size(at('width'), f.width, 'pocket_width', 'Pocket width (mm)', 1, 3, P),
          size(at('length'), f.length, 'pocket_length', 'Pocket length, front to back (mm)', 1, 3, P),
          size(at('depth'), f.depth, 'pocket_depth', 'Pocket depth (mm)', 0.5, 0.5, 50),
        ],
        derived: [],
        rules: [le(ref('pocket_depth'), sub(face.thick, W), 'The pocket leaves less than 1.6 mm under it.')],
        shapes: (env) => {
          const um = evaluate(face.uMid, env);
          const vm = evaluate(face.vMid, env);
          const pw = env.pocket_width! / 2;
          const pl = env.pocket_length! / 2;
          return [box(f.face, true, 'pocket', um - pw, vm - pl, um + pw, vm + pl)];
        },
        extent: {},
      };
    }
    case 'ribs': {
      return {
        sizes: [
          size(at('count'), f.count, 'rib_count', 'Number of ribs', 1, 1, 10),
          size(at('thickness'), f.thickness, 'rib_thickness', 'Rib thickness (mm)', 0.5, W, 10),
          size(at('height'), f.height, 'rib_height', 'Rib height (mm)', 0.5, 1, 50),
        ],
        derived: [{ name: 'rib_pitch', value: div(ref('depth'), add(ref('rib_count'), 1)) }],
        rules: [
          ge(ref('rib_pitch'), add(ref('rib_thickness'), 2), 'The ribs are too close together.'),
          le(ref('rib_height'), mul(8, ref('rib_thickness')), 'The ribs are too tall for their thickness.'),
        ],
        shapes: (env) =>
          Array.from({ length: Math.round(env.rib_count!) }, (_, i) => {
            const v = (i + 1) * env.rib_pitch! - env.rib_thickness! / 2;
            return box('top', false, 'rib', 0, v, env.width!, v + env.rib_thickness!);
          }),
        extent: { z: add(ref('thickness'), ref('rib_height')) },
      };
    }
    case 'bosses': {
      const face = ctx.faces.top!;
      const placed = placeSizes(f.place, path, face, '', '', 'boss');
      const where = spots(f.place, face, '', 'boss');
      return {
        sizes: [
          size(at('d'), f.d, 'boss_d', 'Standoff diameter (mm)', 0.5, 4, 30),
          size(at('height'), f.height, 'boss_height', 'Standoff height (mm)', 0.5, 1, 50),
          size(at('hole'), f.hole, 'boss_hole_d', 'Standoff hole diameter (mm)', 0.5, LIMITS.holeMin, LIMITS.holeMax),
          ...placed.sizes,
        ],
        derived: placed.derived,
        rules: [
          ge(ref('boss_d'), add(ref('boss_hole_d'), 2 * W), 'The standoff wall around its hole is too thin.'),
          le(ref('boss_height'), mul(4, ref('boss_d')), 'The standoffs are too tall for their width.'),
        ],
        shapes: (env) => centers(where, env).map(([u, v]) => ({ face: 'top', cut: false, what: 'standoff', u, v, r: env.boss_d! / 2 })),
        extent: { z: add(ref('thickness'), ref('boss_height')) },
      };
    }
    case 'lip': {
      return {
        sizes: [
          size(at('height'), f.height, 'lip_height', 'Rim height (mm)', 0.5, 1, 50),
          size(at('wall'), f.wall, 'lip_wall', 'Rim thickness (mm)', 0.2, W, 10),
        ],
        derived: [],
        rules: [
          le(ref('lip_height'), mul(10, ref('lip_wall')), 'The rim is too tall for its thickness.'),
          ge(sub(ref('width'), mul(2, ref('lip_wall'))), 6, 'The rim leaves too little room inside.'),
          ge(sub(ref('depth'), mul(2, ref('lip_wall'))), 6, 'The rim leaves too little room inside.'),
        ],
        shapes: (env) => {
          const [w, d, t] = [env.width!, env.depth!, env.lip_wall!];
          return [
            box('top', false, 'rim', 0, 0, w, t, true),
            box('top', false, 'rim', 0, d - t, w, d, true),
            box('top', false, 'rim', 0, 0, t, d, true),
            box('top', false, 'rim', w - t, 0, w, d, true),
          ];
        },
        extent: { z: add(ref('thickness'), ref('lip_height')) },
      };
    }
    case 'notch': {
      const corner = body.kind === 'plate' ? cornerRef(body) : 0;
      return {
        sizes: [
          size(at('width'), f.width, 'notch_width', 'Notch width (mm)', 1, 3, 150),
          size(at('depth'), f.depth, 'notch_depth', 'Notch depth (mm)', 1, 2, 150),
        ],
        derived: [],
        rules: [
          ge(sub(ref('depth'), ref('notch_depth')), 5, 'The notch cuts the plate almost in two.'),
          ge(sub(half(ref('width')), half(ref('notch_width'))), add(corner, 3), 'The notch is too wide for the plate.'),
        ],
        shapes: (env) => {
          const c = env.width! / 2;
          const h = env.notch_width! / 2;
          return [box('top', true, 'notch', c - h, 0, c + h, env.notch_depth!, true)];
        },
        extent: {},
      };
    }
    case 'tabs': {
      const corner = body.kind === 'box' ? cornerRef(body) : 0;
      return {
        sizes: [
          size(at('length'), f.length, 'tab_length', 'Tab length, out from the wall (mm)', 1, 6, 60),
          size(at('width'), f.width, 'tab_width', 'Tab width (mm)', 1, 6, 60),
          size(at('thickness'), f.thickness, 'tab_thickness', 'Tab thickness (mm)', 0.5, W, 10),
          size(at('hole'), f.hole, 'tab_hole_d', 'Tab hole diameter (mm)', 0.5, LIMITS.holeMin, LIMITS.holeMax),
        ],
        derived: [],
        rules: [
          ge(ref('tab_width'), add(ref('tab_hole_d'), 2 * W), 'The tabs are too narrow for their holes.'),
          ge(sub(ref('tab_length'), half(ref('tab_width'))), add(half(ref('tab_hole_d')), W), 'The tab holes are too close to the wall.'),
          le(ref('tab_width'), sub(ref('depth'), add(mul(2, corner), 2)), 'The tabs are wider than the flat part of the side.'),
          le(ref('tab_thickness'), ref('height'), 'The tabs are taller than the box.'),
        ],
        shapes: () => [],
        extent: { x: add(ref('width'), mul(2, ref('tab_length'))) },
      };
    }
    case 'dividers': {
      const corner = body.kind === 'box' ? cornerRef(body) : 0;
      const face = ctx.faces.floor!;
      return {
        sizes: [size(at('count'), f.count, 'divider_count', 'Number of dividers', 1, 1, 8)],
        derived: [{ name: 'divider_pitch', value: div(sub(ref('depth'), ref('wall')), add(ref('divider_count'), 1)) }],
        rules: [
          ge(sub(ref('divider_pitch'), ref('wall')), 8, 'The compartments are narrower than 8 mm.'),
          ge(ref('divider_pitch'), add(corner, ref('wall')), 'A divider runs into a rounded corner.'),
        ],
        shapes: (env) => {
          const [u0, u1] = [evaluate(face.u0, env), evaluate(face.u1, env)];
          return Array.from({ length: Math.round(env.divider_count!) }, (_, i) => {
            const v = (i + 1) * env.divider_pitch!;
            return box('floor', false, 'divider', u0, v, u1, v + env.wall!, true);
          });
        },
        extent: {},
      };
    }
    case 'gussets': {
      const gt = ref('gusset_thickness');
      return {
        sizes: [
          size(at('size'), f.size, 'gusset_size', 'Gusset size (mm)', 1, 4, 150),
          size(at('thickness'), f.thickness, 'gusset_thickness', 'Gusset thickness (mm)', 0.5, W, 15),
        ],
        derived: [],
        rules: [
          le(ref('gusset_size'), sub(ref('base_length'), ref('thickness')), 'The gussets are longer than the base leg.'),
          le(ref('gusset_size'), sub(ref('height'), ref('thickness')), 'The gussets are taller than the upright leg.'),
          ge(ref('width'), add(mul(f.count, gt), 4), 'The bracket is too narrow for its gussets.'),
        ],
        shapes: (env) => {
          const [w, t, g, th] = [env.width!, env.thickness!, env.gusset_size!, env.gusset_thickness!];
          const xs = f.count === 2 ? [0, w - th] : [w / 2 - th / 2];
          return xs.flatMap((x) => [
            box('base', false, 'gusset', x, t, x + th, t + g, true),
            box('upright', false, 'gusset', x, t, x + th, t + g, true),
          ]);
        },
        extent: {},
      };
    }
    case 'flange': {
      const hex = body.kind === 'round' && body.hex;
      const outer = hex ? ref('across_flats') : ref('diameter');
      const across = hex ? div(outer, cos(30)) : outer;
      const fd = ref('flange_d');
      const sizes = [
        size(at('d'), f.d, 'flange_d', 'Flange diameter (mm)', 1, 8, P),
        size(at('thickness'), f.thickness, 'flange_thickness', 'Flange thickness (mm)', 0.5, W, 20),
      ];
      const derived: Derived[] = [];
      const rules = [le(ref('flange_thickness'), sub(ref('height'), 1), 'The flange is as tall as the spacer.')];
      if (f.holes > 0) {
        sizes.push(size(at('holes'), f.holes, 'flange_hole_count', 'Number of flange holes', 1, 2, 8));
        sizes.push(size(at('hole'), f.hole, 'flange_hole_d', 'Flange hole diameter (mm)', 0.5, LIMITS.holeMin, LIMITS.holeMax));
        derived.push({ name: 'bolt_r', value: div(add(across, fd), 4) });
        rules.push(
          ge(div(sub(fd, across), 2), add(ref('flange_hole_d'), 2 * W), 'The flange is too narrow for its holes.'),
          ge(
            mul(mul(2, ref('bolt_r')), sin(div(180, ref('flange_hole_count')))),
            add(ref('flange_hole_d'), W),
            'The flange holes are too close together.',
          ),
        );
      } else {
        rules.push(ge(sub(fd, across), 4, 'The flange is not wider than the spacer.'));
      }
      return { sizes, derived, rules, shapes: () => [], extent: { x: max(fd, across), y: max(fd, outer) } };
    }
    case 'lips': {
      return {
        sizes: [size(at('width'), f.width, 'lip_width', 'Lip width (mm)', 0.5, 1, 20)],
        derived: [],
        rules: [
          ge(sub(ref('width'), mul(2, add(ref('wall'), ref('lip_width')))), 4, 'The lips close the channel.'),
          ge(sub(ref('height'), ref('floor_thickness')), add(mul(1.5, ref('lip_width')), 3.2), 'The lips reach down to the floor.'),
        ],
        shapes: () => [],
        extent: {},
      };
    }
    case 'grips': {
      return {
        sizes: [
          size(at('count'), f.count, 'grip_count', 'Number of grip notches', 1, 6, 40),
          size(at('d'), f.d, 'grip_d', 'Grip notch diameter (mm)', 0.5, 2, 12),
        ],
        derived: [],
        rules: [
          ge(div(mul(ref('diameter'), 3.1416), ref('grip_count')), add(ref('grip_d'), W), 'The grip notches run into each other.'),
          ge(sub(sub(half(ref('diameter')), half(ref('grip_d'))), half(ref('shaft_d'))), W, 'The grip notches reach the shaft hole.'),
        ],
        shapes: () => [],
        extent: {},
      };
    }
    case 'flat': {
      return {
        sizes: [size(at('depth'), f.depth, 'flat_depth', 'Flat on the shaft hole, depth (mm)', 0.5, 0.5, 4)],
        derived: [],
        rules: [le(ref('flat_depth'), div(ref('shaft_d'), 3), 'The flat is too deep for the shaft hole.')],
        shapes: () => [],
        extent: {},
      };
    }
  }
}
