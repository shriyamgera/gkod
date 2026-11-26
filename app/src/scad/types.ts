import type { Report } from '@gkod/checks';

export type Param = {
  name: string;
  value: number;
  min: number;
  max: number;
  step: number;
  caption?: string;
  // set when the code lists the allowed values, e.g. "screw = 3; // [3, 4, 5, 6, 8]"; only these may be picked
  options?: number[];
};

export type CompileResult =
  // ms: the compile alone; checks.ms is the time the print checks took on top
  | { ok: true; stl: ArrayBuffer; params: Param[]; log: string[]; ms: number; checks?: Report }
  | { ok: false; error: string; log: string[]; ms: number };
