export type Param = { name: string; value: number; min: number; max: number; step: number; caption?: string };

export type CompileResult =
  | { ok: true; stl: ArrayBuffer; params: Param[]; log: string[]; ms: number }
  | { ok: false; error: string; log: string[]; ms: number };
