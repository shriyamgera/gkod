export type Vec3 = [number, number, number];

/** Printer build volume in mm. */
export type Bed = { x: number; y: number; z: number };

export const DEFAULT_BED: Bed = { x: 256, y: 256, z: 256 };

export type CheckId = 'closed' | 'fits-bed' | 'flat-base' | 'overhang';

export type CheckResult = {
  id: CheckId;
  ok: boolean;
  /** The short line for the list of checks, e.g. "Solid, no holes". */
  title: string;
  /** One plain sentence: what is wrong, or what was found. */
  detail: string;
  /** Set on a failure: what to ask the engine to change. Always our own words. */
  fix?: string;
  /** Overhang only: indices of the triangles in the problem areas. */
  triangles?: number[];
  /** Overhang only: where the biggest problem area sags most, for the "Would sag here" marker. */
  at?: Vec3;
};

export type Report = {
  ok: boolean;
  /** Always in the order closed, fits-bed, flat-base, overhang. */
  results: CheckResult[];
  ms: number;
  stats: { triangles: number; volume: number; size: Vec3; min: Vec3 };
};

export type CheckOptions = { bed?: Bed; overhangDeg?: number };
