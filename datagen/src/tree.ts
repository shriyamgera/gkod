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
  | { kind: 'clip'; cable: number; wall: number; grip: number; length: number; pad: number; padThickness: number }
  | { kind: 'disc'; diameter: number; thickness: number }
  // a strap over a pipe with a foot on each side, printed on its side
  | { kind: 'saddle'; pipe: number; thickness: number; foot: number; width: number }
  // a bar on two posts, printed on its side; spacing is between the screw holes
  | { kind: 'handle'; spacing: number; length: number; height: number; grip: number; post: number; width: number; screw: number; screwDepth: number }
  // a round foot, wide end down, narrowing to its top
  | { kind: 'foot'; diameter: number; top: number; height: number }
  // a tube that fits a hole; diameter is its outside
  | { kind: 'sleeve'; diameter: number; wall: number; height: number }
  // sides 0 is round, 6 or 8 a hexagon or octagon; diameter is across the corners
  | { kind: 'cup'; diameter: number; height: number; wall: number; floor: number; sides: 0 | 6 | 8 }
  // a plate with a row of slots in its front edge
  | { kind: 'comb'; width: number; depth: number; thickness: number; slots: number; slot: number; slotDepth: number }
  // a flat L: two arms of the same length meeting at a square corner
  | { kind: 'corner'; length: number; arm: number; thickness: number };

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
  | { kind: 'flat'; depth: number }
  // a cut as wide as the bore, from the bore out through the side, so a washer slides on from the side
  | { kind: 'slit' }
  | { kind: 'grooves'; count: number; d: number }
  // a grid of blind sockets in the top, round or hex (d is across the flats)
  | { kind: 'sockets'; columns: number; rows: number; d: number; depth: number; pitch: number; hex: boolean };

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
    features: ['holes', 'slots', 'pocket', 'ribs', 'bosses', 'lip', 'notch', 'sockets'],
    faces: { top: ['center', 'pair', 'row', 'corners', 'grid'] },
  },
  box: { features: ['holes', 'tabs', 'dividers', 'bosses'], faces: { floor: ['center', 'pair', 'row', 'corners', 'grid'] } },
  angle: {
    features: ['holes', 'slots', 'gussets'],
    faces: { base: ['center', 'pair', 'row'], upright: ['center', 'pair', 'row'] },
  },
  channel: { features: ['holes', 'slots', 'lips'], faces: { floor: ['center', 'pair', 'row'] } },
  round: { features: ['flange', 'slit'], faces: {} },
  hook: { features: ['holes'], faces: { plate: ['center', 'pair'] } },
  knob: { features: ['grips', 'flat'], faces: {} },
  clip: { features: ['holes'], faces: { pad: ['pair'] } },
  disc: { features: ['lip'], faces: {} },
  saddle: { features: ['holes'], faces: { feet: ['pair'] } },
  handle: { features: ['grooves'], faces: {} },
  foot: { features: ['holes'], faces: { top: ['center'] } },
  sleeve: { features: ['flange'], faces: {} },
  cup: { features: ['holes'], faces: { floor: ['center', 'grid'] } },
  comb: { features: ['holes'], faces: { spine: ['center', 'pair', 'row'] } },
  corner: { features: ['holes'], faces: { arm1: ['center', 'pair', 'row'], arm2: ['center', 'pair', 'row'] } },
};
