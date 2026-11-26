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
  | { ok: true; stl: ArrayBuffer; params: Param[]; log: string[]; ms: number }
  | { ok: false; error: string; log: string[]; ms: number };
