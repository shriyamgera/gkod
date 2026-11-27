// Small helpers the families share for picking sizes that fit.
import type { Rng } from '../rng.ts';
import type { Feature, Place } from '../tree.ts';

export type Span = readonly [number, number];

/** A size from lo to hi on the step, or undefined when nothing on the step fits. */
export function fit(rng: Rng, lo: number, hi: number, step = 1): number | undefined {
  const first = Math.ceil(lo / step - 1e-9);
  const last = Math.floor(hi / step + 1e-9);
  return last < first ? undefined : rng.size(first * step, last * step, step);
}

/** Common screw clearance holes, in mm. */
export const SCREW_HOLES = [3, 3.5, 4, 4.5, 5, 5.5, 6] as const;

/** The room a hole needs around its centre: its radius, or the countersink's, plus a wall. */
export const holeRoom = (d: number, countersink: boolean) => (countersink ? d : d / 2) + 1.6;

/**
 * A hole pattern for a rectangular face of size len x wide (u along len), kept clear of the edges.
 * Returns undefined when the face is too small for the pattern.
 */
export function placeOn(rng: Rng, pattern: Place['pattern'], len: number, wide: number, room: number): Place | undefined {
  switch (pattern) {
    case 'center':
      return { pattern };
    case 'pair': {
      const spacing = fit(rng, Math.max(2 * room + 2, len * 0.3), Math.min(len - 2 * room - 2, len * 0.8));
      return spacing === undefined ? undefined : { pattern, spacing };
    }
    case 'corners': {
      const inset = fit(rng, room + 1, Math.min(room + 10, Math.min(len, wide) / 2 - room - 2), 0.5);
      return inset === undefined ? undefined : { pattern, inset };
    }
    case 'grid': {
      const x = fit(rng, Math.max(2 * room + 2, len * 0.3), len - 2 * room - 4);
      const y = fit(rng, Math.max(2 * room + 2, wide * 0.3), wide - 2 * room - 4);
      return x === undefined || y === undefined ? undefined : { pattern, x, y };
    }
    case 'row': {
      const inset = fit(rng, room + 1, Math.min(room + 12, len / 4), 0.5);
      if (inset === undefined) return undefined;
      const most = Math.floor((len - 2 * inset) / (2 * room + 2)) + 1;
      if (most < 2) return undefined;
      // a row with no room for a third hole is a pair, so its count slider is never stuck
      if (most < 3) return { pattern: 'pair', spacing: Math.floor(len - 2 * inset) };
      return { pattern, count: rng.int(2, Math.min(5, most)), inset };
    }
  }
}

/** A set of screw holes on a face, or undefined when none fit. */
export function screwHoles(
  rng: Rng,
  face: string,
  patterns: readonly Place['pattern'][],
  len: number,
  wide: number,
  thick: number,
  sinkChance: number,
  largest = 6,
): Feature | undefined {
  const d = rng.pick(SCREW_HOLES.filter((hole) => hole <= largest));
  const countersink = thick >= d / 2 + 1.5 && rng.chance(sinkChance);
  const room = holeRoom(d, countersink);
  if (wide < 2 * room + 1) return undefined;
  const place = placeOn(rng, rng.pick(patterns), len, wide, room);
  return place && { kind: 'holes', face, d, countersink, place };
}
