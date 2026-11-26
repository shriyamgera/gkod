import type { GcodeReport } from '@gkod/checks';

export type Quality = 'normal' | 'fine';
export type Infill = 10 | 15 | 20 | 30;

export type SliceSettings = { printerId: string; quality: Quality; infill: Infill; supports: boolean };

export type SliceResult =
  // seconds and filamentMm are the slicer's own estimates
  | { ok: true; gcode: Blob; seconds: number; filamentMm: number; layers: number; ms: number; safety: GcodeReport }
  | { ok: false; error: string; ms: number; safety?: GcodeReport };

export const QUALITIES: readonly Quality[] = ['normal', 'fine'];
export const INFILLS: readonly Infill[] = [10, 15, 20, 30];

/** Layer height in mm for each quality. */
export const LAYER_MM: Record<Quality, number> = { normal: 0.2, fine: 0.12 };
