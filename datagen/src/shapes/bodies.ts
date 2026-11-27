// The code for each base body, built from basic shapes.
import {
  add,
  call,
  circle,
  cube,
  cylinder,
  difference,
  each,
  div,
  cos,
  half,
  hull,
  linearExtrude,
  type Module,
  mirror,
  mul,
  neg,
  type Node,
  offset,
  polygon,
  ref,
  rotate,
  square,
  sub,
  translate,
  union,
} from '../scad.ts';
import type { Body, Tree } from '../tree.ts';

export type Built = { modules: Module[]; adds: Node[]; cuts: Node[] };

const r = ref;

function outline(body: Extract<Body, { corner: unknown }>): Module {
  const [w, d] = [r('width'), r('depth')];
  if (body.corner === 'round') {
    const c = r('corner_r');
    return { name: 'outline', body: [translate([c, c], offset({ r: c }, square([sub(w, mul(2, c)), sub(d, mul(2, c))])))] };
  }
  if (body.corner === 'chamfer') {
    const c = r('chamfer');
    const points = [[c, 0], [sub(w, c), 0], [w, c], [w, sub(d, c)], [sub(w, c), d], [c, d], [0, sub(d, c)], [0, c]];
    return { name: 'outline', body: [polygon(points)] };
  }
  return { name: 'outline', body: [square([w, d])] };
}

// The hook seen from the side: one outline for the back, the arm and the tip, with the outer front corner cut off, and a
// rounded inside corner where the arm meets the back.
function hookProfile(): Node[] {
  const [t, x, b, tip, f] = [r('thickness'), r('reach'), r('bevel'), r('tip_height'), r('fillet')];
  const inner = sub(x, t);
  return [
    polygon([[0, 0], [sub(x, b), 0], [x, b], [x, tip], [inner, tip], [inner, t], [t, t], [t, r('back_height')], [0, r('back_height')]]),
    translate([t, t], difference(square([f, f]), translate([f, f], circle(mul(2, f))))),
  ];
}

function channelProfile(lips: boolean): Node[] {
  const [w, h, wall] = [r('width'), r('height'), r('wall')];
  const nodes = [square([w, r('floor_thickness')]), square([wall, h]), translate([sub(w, wall), 0], square([wall, h]))];
  if (lips) {
    // the underside slopes up toward the opening, so the lip prints without supports
    const lip = r('lip_width');
    const shape = polygon([[wall, h], [add(wall, lip), h], [add(wall, lip), sub(h, 1.2)], [wall, sub(sub(h, 1.2), mul(1.5, lip))]]);
    nodes.push(shape, translate([w, 0], mirror([1, 0], shape)));
  }
  return nodes;
}

function shaft(flat: boolean): Node {
  const [d, depth] = [r('shaft_d'), r('shaft_depth')];
  const hole = cylinder({ d, h: add(depth, 1) });
  const body = flat
    ? difference(hole, translate([sub(half(d), r('flat_depth')), neg(half(d)), -1], cube([d, d, add(depth, 3)])))
    : hole;
  return translate([0, 0, sub(r('height'), depth)], body);
}

export function bodyShapes(tree: Tree): Built {
  const body = tree.body;
  const has = (kind: string) => tree.features.some((feature) => feature.kind === kind);
  switch (body.kind) {
    case 'plate':
      return {
        modules: [outline(body), { name: 'plate', body: [linearExtrude(r('thickness'), call('outline'))] }],
        adds: [call('plate')],
        cuts: [],
      };
    case 'box': {
      const cavity = translate([0, 0, r('floor_thickness')], linearExtrude(r('height'), offset({ delta: neg(r('wall')) }, call('outline'))));
      return {
        modules: [outline(body), { name: 'box', body: [difference(linearExtrude(r('height'), call('outline')), cavity)] }],
        adds: [call('box')],
        cuts: [],
      };
    }
    case 'angle':
      return {
        modules: [
          { name: 'profile', body: [square([r('base_length'), r('thickness')]), square([r('thickness'), r('height')])] },
          // the side view is drawn in (y, z) and runs along x
          { name: 'bracket', body: [rotate([90, 0, 90], linearExtrude(r('width'), call('profile')))] },
        ],
        adds: [call('bracket')],
        cuts: [],
      };
    case 'channel':
      return {
        modules: [
          { name: 'profile', body: channelProfile(has('lips')) },
          { name: 'channel', body: [translate([0, r('length'), 0], rotate([90, 0, 0], linearExtrude(r('length'), call('profile'))))] },
        ],
        adds: [call('channel')],
        cuts: [],
      };
    case 'round': {
      const column = body.hex
        ? cylinder({ d: div(r('across_flats'), cos(30)), h: r('height'), fn: 6 })
        : cylinder({ d: r('diameter'), h: r('height') });
      return {
        modules: [
          { name: 'spacer', body: [column] },
          { name: 'bore', body: [translate([0, 0, -1], cylinder({ d: r('bore_d'), h: add(r('height'), 2) }))] },
        ],
        adds: [call('spacer')],
        cuts: [call('bore')],
      };
    }
    case 'hook':
      return {
        modules: [
          { name: 'profile', body: hookProfile() },
          // drawn lying on its side, the way it prints, so the layers run along the hook
          { name: 'hook', body: [linearExtrude(r('width'), call('profile'))] },
        ],
        adds: [call('hook')],
        cuts: [],
      };
    case 'knob': {
      const ch = r('chamfer');
      return {
        modules: [
          // printed face down; the chamfer is on the back edge, where the shaft goes in
          {
            name: 'knob',
            body: [hull(cylinder({ d: r('diameter'), h: sub(r('height'), ch) }), cylinder({ d: sub(r('diameter'), mul(2, ch)), h: r('height') }))],
          },
          { name: 'shaft', body: [shaft(has('flat'))] },
        ],
        adds: [call('knob')],
        cuts: [call('shaft')],
      };
    }
    case 'clip': {
      const d = r('outer_d');
      // a column that rises from the base and is round on top, with the cable's hole and a way in from the top
      const holder = hull(translate([neg(half(d)), 0], square([d, r('base_thickness')])), translate([0, r('center_y')], circle(d)));
      const hole = translate([0, r('center_y')], circle(r('cable_d')));
      const entry = translate([neg(half(r('opening'))), r('center_y')], square([r('opening'), d]));
      return {
        modules: [
          {
            name: 'profile',
            body: [translate([neg(half(r('base_width'))), 0], square([r('base_width'), r('base_thickness')])), difference(holder, hole, entry)],
          },
          // drawn lying on its side, the way it prints, so the round part needs no supports
          { name: 'clip', body: [linearExtrude(r('length'), call('profile'))] },
        ],
        adds: [call('clip')],
        cuts: [],
      };
    }
    case 'disc':
      return {
        modules: [
          { name: 'outline', body: [circle(r('diameter'))] },
          { name: 'disc', body: [linearExtrude(r('thickness'), call('outline'))] },
        ],
        adds: [call('disc')],
        cuts: [],
      };
    case 'saddle': {
      const [pipe, t, outer, span] = [r('pipe_d'), r('thickness'), r('outer_r'), r('span')];
      // the pipe's centre sits half a pipe out from the wall; the strap goes over it and down to the feet
      const strap = union(
        translate([neg(half(span)), 0], square([span, t])),
        translate([neg(outer), 0], square([mul(2, outer), half(pipe)])),
        translate([0, half(pipe)], circle(mul(2, outer))),
      );
      const room = [translate([0, half(pipe)], circle(pipe)), translate([neg(half(pipe)), -1], square([pipe, add(half(pipe), 1)]))];
      return {
        modules: [
          { name: 'profile', body: [difference(strap, ...room)] },
          // drawn lying on its side, the way it prints, so the round strap needs no supports
          { name: 'saddle', body: [linearExtrude(r('width'), call('profile'))] },
        ],
        adds: [call('saddle')],
        cuts: [],
      };
    }
    case 'handle': {
      const [len, h, grip, post, spacing] = [r('length'), r('height'), r('grip'), r('post'), r('hole_spacing')];
      const end = half(sub(len, grip));
      const bar = hull(translate([neg(end), sub(h, half(grip))], circle(grip)), translate([end, sub(h, half(grip))], circle(grip)));
      const posts = each([['x', [neg(half(spacing)), half(spacing)]]], translate([sub(r('x'), half(post)), 0], square([post, sub(h, half(grip))])));
      const holes = each(
        [['x', [neg(half(spacing)), half(spacing)]]],
        translate([r('x'), -1, half(r('width'))], rotate([-90, 0, 0], cylinder({ d: r('screw_d'), h: add(r('screw_depth'), 1) }))),
      );
      return {
        modules: [
          { name: 'profile', body: [bar, posts] },
          // drawn lying on its side, the way it prints, so the bar needs no supports
          { name: 'handle', body: [linearExtrude(r('width'), call('profile'))] },
          // screws come in from behind the drawer front, into the posts
          { name: 'screw_holes', body: [holes] },
        ],
        adds: [call('handle')],
        cuts: [call('screw_holes')],
      };
    }
    case 'foot':
      return {
        // printed wide end down; it narrows to the top
        modules: [{ name: 'foot', body: [cylinder({ d1: r('diameter'), d2: r('top_d'), h: r('height') })] }],
        adds: [call('foot')],
        cuts: [],
      };
    case 'sleeve':
      return {
        modules: [
          { name: 'sleeve', body: [cylinder({ d: r('diameter'), h: r('height') })] },
          { name: 'opening', body: [translate([0, 0, -1], cylinder({ d: r('inner_d'), h: add(r('height'), 2) }))] },
        ],
        adds: [call('sleeve')],
        cuts: [call('opening')],
      };
    case 'cup': {
      const fn = body.sides || undefined;
      const inside = translate([0, 0, r('floor_thickness')], cylinder({ d: r('inner_d'), h: r('height'), fn }));
      return {
        modules: [{ name: 'cup', body: [difference(cylinder({ d: r('diameter'), h: r('height'), fn }), inside)] }],
        adds: [call('cup')],
        cuts: [],
      };
    }
    case 'comb': {
      const w = r('slot_width');
      // each slot runs in from the front edge and ends in a half circle
      const slot = hull(translate([neg(half(w)), -1], square([w, 1])), translate([0, sub(r('slot_depth'), half(w))], circle(w)));
      const slots = each([['i', { from: 0, to: sub(r('slot_count'), 1) }]], translate([mul(add(r('i'), 0.5), r('slot_pitch')), 0], slot));
      return {
        modules: [
          { name: 'outline', body: [difference(square([r('width'), r('depth')]), slots)] },
          { name: 'comb', body: [linearExtrude(r('thickness'), call('outline'))] },
        ],
        adds: [call('comb')],
        cuts: [],
      };
    }
    case 'corner': {
      const [len, arm, f] = [r('length'), r('arm_width'), r('fillet')];
      return {
        modules: [
          {
            name: 'outline',
            body: [
              square([len, arm]),
              square([arm, len]),
              // a rounded fill in the inside corner, where the arms meet
              translate([arm, arm], difference(square([f, f]), translate([f, f], circle(mul(2, f))))),
            ],
          },
          { name: 'corner_plate', body: [linearExtrude(r('thickness'), call('outline'))] },
        ],
        adds: [call('corner_plate')],
        cuts: [],
      };
    }
  }
}
