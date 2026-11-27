// The code for each feature, built from basic shapes and placed on its face.
import { prefixOf, spots } from '../features.ts';
import type { Model } from '../model.ts';
import {
  add,
  call,
  cos,
  cube,
  cylinder,
  difference,
  div,
  each,
  type Expr,
  half,
  hull,
  linearExtrude,
  mirror,
  mul,
  neg,
  type Node,
  offset,
  polygon,
  ref,
  rotate,
  sub,
  translate,
} from '../scad.ts';
import type { Feature, Tree } from '../tree.ts';
import type { Built } from './bodies.ts';
import { holeTool, placeAll, shift } from './place.ts';

const r = ref;
const none = (): Built => ({ modules: [], adds: [], cuts: [] });

function slotShape(length: Expr, width: Expr, depth: Expr, axis: number): Node {
  const end = half(sub(length, width));
  const along = (by: Expr) => [0, 1, 2].map((i) => (i === axis ? by : 0));
  return hull(translate(along(neg(end)), cylinder({ d: width, h: depth })), translate(along(end), cylinder({ d: width, h: depth })));
}

export function featureShapes(f: Feature, tree: Tree, model: Model): Built {
  switch (f.kind) {
    case 'holes': {
      const face = model.faces[f.face]!;
      const { p } = prefixOf(tree.body, f.face);
      const placed = placeAll(spots(f.place, face, p, 'hole'), face, holeTool(face, r(`${p}hole_d`), f.countersink));
      return { modules: [{ name: `${p}holes`, body: [placed] }], adds: [], cuts: [call(`${p}holes`)] };
    }
    case 'slots': {
      const face = model.faces[f.face]!;
      const { p } = prefixOf(tree.body, f.face);
      const along = f.along === 'u' ? face.uAxis : face.vAxis;
      const shape = slotShape(r(`${p}slot_length`), r(`${p}slot_width`), add(face.thick, 2), { x: 0, y: 1, z: 2 }[along]);
      let [u, v] = [face.uMid, face.vMid];
      const loops: [string, Expr[]][] = [];
      if (f.count === 2) {
        // two slots side by side
        const s = half(r(`${p}slot_spacing`));
        if (f.along === 'u') {
          loops.push([face.vAxis, [sub(face.vMid, s), add(face.vMid, s)]]);
          v = r(face.vAxis);
        } else {
          loops.push([face.uAxis, [sub(face.uMid, s), add(face.uMid, s)]]);
          u = r(face.uAxis);
        }
      }
      const node = translate(shift(face.at(u, v), face.normal, -1), shape);
      return { modules: [{ name: `${p}slots`, body: [loops.length ? each(loops, node) : node] }], adds: [], cuts: [call(`${p}slots`)] };
    }
    case 'pocket': {
      const face = model.faces[f.face]!;
      const [w, l, d] = [r('pocket_width'), r('pocket_length'), r('pocket_depth')];
      const node = translate([sub(face.uMid, half(w)), sub(face.vMid, half(l)), sub(face.thick, d)], cube([w, l, add(d, 1)]));
      return { modules: [{ name: 'pocket', body: [node] }], adds: [], cuts: [call('pocket')] };
    }
    case 'ribs': {
      const node = each(
        [['i', { from: 1, to: r('rib_count') }]],
        translate([0, sub(mul(r('i'), r('rib_pitch')), half(r('rib_thickness'))), r('thickness')], cube([r('width'), r('rib_thickness'), r('rib_height')])),
      );
      return { modules: [{ name: 'ribs', body: [node] }], adds: [call('ribs')], cuts: [] };
    }
    case 'bosses': {
      // on a plate's top, or on the floor inside a box
      const face = model.faces.top ?? model.faces.floor!;
      const where = spots(f.place, face, '', 'boss');
      const posts = placeAll(where, face, (at) => translate([at[0]!, at[1]!, face.thick], cylinder({ d: r('boss_d'), h: r('boss_height') })));
      const holes = placeAll(where, face, (at) =>
        translate([at[0]!, at[1]!, -1], cylinder({ d: r('boss_hole_d'), h: add(add(face.thick, r('boss_height')), 2) })),
      );
      return {
        modules: [
          { name: 'standoffs', body: [posts] },
          { name: 'standoff_holes', body: [holes] },
        ],
        adds: [call('standoffs')],
        cuts: [call('standoff_holes')],
      };
    }
    case 'lip': {
      const ring = difference(call('outline'), offset({ delta: neg(r('lip_wall')) }, call('outline')));
      return {
        modules: [{ name: 'rim', body: [translate([0, 0, r('thickness')], linearExtrude(r('lip_height'), ring))] }],
        adds: [call('rim')],
        cuts: [],
      };
    }
    case 'notch': {
      const node = translate(
        [sub(half(r('width')), half(r('notch_width'))), -1, -1],
        cube([r('notch_width'), add(r('notch_depth'), 1), add(r('thickness'), 2)]),
      );
      return { modules: [{ name: 'notch', body: [node] }], adds: [], cuts: [call('notch')] };
    }
    case 'tabs': {
      const [len, w, t] = [r('tab_length'), r('tab_width'), r('tab_thickness')];
      const end = sub(len, half(w));
      const tab = difference(
        hull(translate([-1, neg(half(w)), 0], cube([1, w, t])), translate([end, 0, 0], cylinder({ d: w, h: t }))),
        translate([end, 0, -1], cylinder({ d: r('tab_hole_d'), h: add(t, 2) })),
      );
      return {
        modules: [
          { name: 'tab', body: [tab] },
          {
            name: 'tabs',
            body: [translate([r('width'), half(r('depth')), 0], call('tab')), translate([0, half(r('depth')), 0], mirror([1, 0, 0], call('tab')))],
          },
        ],
        adds: [call('tabs')],
        cuts: [],
      };
    }
    case 'dividers': {
      const node = each(
        [['i', { from: 1, to: r('divider_count') }]],
        translate([half(r('wall')), mul(r('i'), r('divider_pitch')), 0], cube([sub(r('width'), r('wall')), r('wall'), r('height')])),
      );
      return { modules: [{ name: 'dividers', body: [node] }], adds: [call('dividers')], cuts: [] };
    }
    case 'gussets': {
      const [t, g, gt] = [r('thickness'), r('gusset_size'), r('gusset_thickness')];
      const gusset = rotate([90, 0, 90], linearExtrude(gt, polygon([[t, t], [add(t, g), t], [t, add(t, g)]])));
      const placed =
        f.count === 2
          ? each([['x', [0, sub(r('width'), gt)]]], translate([r('x'), 0, 0], call('gusset')))
          : translate([sub(half(r('width')), half(gt)), 0, 0], call('gusset'));
      return {
        modules: [
          { name: 'gusset', body: [gusset] },
          { name: 'gussets', body: [placed] },
        ],
        adds: [call('gussets')],
        cuts: [],
      };
    }
    case 'flange': {
      const built: Built = {
        modules: [{ name: 'flange', body: [cylinder({ d: r('flange_d'), h: r('flange_thickness') })] }],
        adds: [call('flange')],
        cuts: [],
      };
      if (f.holes > 0) {
        const n = r('flange_hole_count');
        const hole = each(
          [['i', { from: 0, to: sub(n, 1) }]],
          rotate([0, 0, div(mul(r('i'), 360), n)], translate([r('bolt_r'), 0, -1], cylinder({ d: r('flange_hole_d'), h: add(r('flange_thickness'), 2) }))),
        );
        built.modules.push({ name: 'flange_holes', body: [hole] });
        built.cuts.push(call('flange_holes'));
      }
      return built;
    }
    case 'grips': {
      const n = r('grip_count');
      const node = each(
        [['i', { from: 0, to: sub(n, 1) }]],
        rotate([0, 0, div(mul(r('i'), 360), n)], translate([half(r('diameter')), 0, -1], cylinder({ d: r('grip_d'), h: add(r('height'), 2) }))),
      );
      return { modules: [{ name: 'grips', body: [node] }], adds: [], cuts: [call('grips')] };
    }
    case 'slit': {
      const body = tree.body;
      const outer = body.kind === 'round' && body.hex ? r('across_flats') : r('diameter');
      const node = translate([neg(half(r('bore_d'))), 0, -1], cube([r('bore_d'), outer, add(r('height'), 2)]));
      return { modules: [{ name: 'slit', body: [node] }], adds: [], cuts: [call('slit')] };
    }
    case 'grooves': {
      // round scallops in the underside of the bar, between the posts, where the fingers go
      const x = mul(sub(r('i'), half(sub(r('groove_count'), 1))), r('groove_pitch'));
      const node = each(
        [['i', { from: 0, to: sub(r('groove_count'), 1) }]],
        translate([x, sub(r('height'), r('grip')), -1], cylinder({ d: r('groove_d'), h: add(r('width'), 2) })),
      );
      return { modules: [{ name: 'grooves', body: [node] }], adds: [], cuts: [call('grooves')] };
    }
    case 'sockets': {
      const face = model.faces.top!;
      const [pitch, d, depth] = [r('socket_pitch'), r('socket_d'), r('socket_depth')];
      const at = (index: string, n: string, mid: Expr) => add(mid, mul(sub(r(index), half(sub(r(n), 1))), pitch));
      const socket = f.hex ? cylinder({ d: div(d, cos(30)), h: add(depth, 1), fn: 6 }) : cylinder({ d, h: add(depth, 1) });
      const node = each(
        [
          ['i', { from: 0, to: sub(r('column_count'), 1) }],
          ['j', { from: 0, to: sub(r('row_count'), 1) }],
        ],
        translate([at('i', 'column_count', face.uMid), at('j', 'row_count', face.vMid), sub(face.thick, depth)], socket),
      );
      return { modules: [{ name: 'sockets', body: [node] }], adds: [], cuts: [call('sockets')] };
    }
    case 'lips':
    case 'flat':
      // drawn by the body: the lips are part of the channel's side view, the flat is part of the shaft hole
      return none();
  }
}
