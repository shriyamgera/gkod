// A part as a feature tree: one base body plus features on it. Every number is in mm unless it is a count.

export type Corner = 'sharp' | 'round' | 'chamfer';

export type Body =
  | { kind: 'plate'; width: number; depth: number; thickness: number; corner: Corner; cornerSize: number }
  | { kind: 'box'; width: number; depth: number; height: number; wall: number; floor: number; corner: Corner; cornerSize: number }
  | { kind: 'angle'; width: number; base: number; height: number; thickness: number }
  | { kind: 'channel'; width: number; length: number; height: number; wall: number; floor: number }
  // diameter is the width across flats when hex is true
  | { kind: 'round'; diameter: number; height: number; bore: number; hex: boolean }
  | { kind: 'hook'; width: number; plate: number; reach: number; tip: number; thickness: number }
  | { kind: 'knob'; diameter: number; height: number; shaft: number; shaftDepth: number; chamfer: number }
  | { kind: 'clip'; cable: number; wall: number; grip: number; length: number; pad: number; padThickness: number };

export type BodyKind = Body['kind'];

/** Where a set of holes or standoffs sits on a face. */
export type Place =
  | { pattern: 'center' }
  | { pattern: 'pair'; spacing: number }
  | { pattern: 'row'; count: number; inset: number }
  | { pattern: 'corners'; inset: number }
  | { pattern: 'grid'; x: number; y: number };

export type Pattern = Place['pattern'];

export type Feature =
  | { kind: 'holes'; face: string; d: number; countersink: boolean; place: Place }
  | { kind: 'slots'; face: string; count: number; length: number; width: number; spacing: number; along: 'u' | 'v' }
  | { kind: 'pocket'; face: string; width: number; length: number; depth: number }
  | { kind: 'ribs'; count: number; thickness: number; height: number }
  | { kind: 'bosses'; d: number; height: number; hole: number; place: Place }
  | { kind: 'lip'; height: number; wall: number }
  | { kind: 'notch'; width: number; depth: number }
  | { kind: 'tabs'; length: number; width: number; thickness: number; hole: number }
  | { kind: 'dividers'; count: number }
  | { kind: 'gussets'; count: number; size: number; thickness: number }
  | { kind: 'flange'; d: number; thickness: number; holes: number; hole: number }
  | { kind: 'lips'; width: number }
  | { kind: 'grips'; count: number; d: number }
  | { kind: 'flat'; depth: number };

export type FeatureKind = Feature['kind'];

export type Tree = { family: string; body: Body; features: Feature[] };

export const LIMITS = {
  /** Thinnest wall that prints reliably with a 0.4 mm nozzle (four lines). */
  wall: 1.6,
  /** Smallest and largest hole. */
  holeMin: 2,
  holeMax: 12,
  /** Largest hole through a wall that stands up while printing: its top must bridge. */
  sideHoleMax: 10,
  /** Every part fits in this cube. */
  part: 200,
} as const;

/** Which features each body takes, and which faces carry features. */
export const ALLOWED: Record<BodyKind, { features: FeatureKind[]; faces: Record<string, Pattern[]> }> = {
  plate: {
    features: ['holes', 'slots', 'pocket', 'ribs', 'bosses', 'lip', 'notch'],
    faces: { top: ['center', 'pair', 'row', 'corners', 'grid'] },
  },
  box: { features: ['holes', 'tabs', 'dividers'], faces: { floor: ['center', 'pair', 'row', 'corners', 'grid'] } },
  angle: {
    features: ['holes', 'slots', 'gussets'],
    faces: { base: ['center', 'pair', 'row'], upright: ['center', 'pair', 'row'] },
  },
  channel: { features: ['holes', 'slots', 'lips'], faces: { floor: ['center', 'pair', 'row'] } },
  round: { features: ['flange'], faces: {} },
  hook: { features: ['holes'], faces: { plate: ['center', 'pair'] } },
  knob: { features: ['grips', 'flat'], faces: {} },
  clip: { features: ['holes'], faces: { pad: ['pair'] } },
};
