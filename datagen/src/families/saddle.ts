import type { Rng } from '../rng.ts';
import type { Tree } from '../tree.ts';

export const saddle = {
  id: 'saddle',
  pipe: [8, 50],
  thickness: [2.5, 5],
  width: [10, 30],
  foot: [10, 25],
  holes: [3.5, 4, 4.5, 5],
  countersink: 0.4,
} as const;

export function sampleSaddle(rng: Rng): Tree {
  const f = saddle;
  const pipe = rng.size(f.pipe[0], f.pipe[1], 0.5);
  const thickness = rng.size(f.thickness[0], f.thickness[1], 0.5);
  const d = rng.pick(f.holes);
  const countersink = thickness >= d / 2 + 1.5 && rng.chance(f.countersink);
  // a foot has room for a screw head beside the strap and a wall at its end
  const leastFoot = Math.ceil(Math.max(2 * d + 2, 2 * (countersink ? d : d / 2) + 2 * 1.6) + 0.5);
  const foot = rng.size(Math.max(f.foot[0], leastFoot), Math.max(f.foot[1], leastFoot));
  const leastWidth = Math.ceil(2 * (countersink ? d : d / 2) + 4);
  const width = rng.size(Math.max(f.width[0], leastWidth), Math.max(f.width[1], leastWidth));
  // one screw through the middle of each foot
  const spacing = pipe + 2 * thickness + foot;
  return {
    family: f.id,
    body: { kind: 'saddle', pipe, thickness, foot, width },
    features: [{ kind: 'holes', face: 'feet', d, countersink, place: { pattern: 'pair', spacing } }],
  };
}
