export type CompileRequest = { type: 'compile'; id: number; source: string; overrides: Record<string, number> };

export type WorkerRequest =
  | CompileRequest
  // drops a compile that is still waiting for the compiler to load; one that has begun can only be stopped by ending the worker
  | { type: 'cancel'; id: number };

export type WorkerReply =
  // sent once the compiler is loaded and the compile is about to run, so loading does not count against the time limit
  | { type: 'start'; id: number }
  | { type: 'cancelled'; id: number }
  | { type: 'done'; id: number; ok: true; stl: ArrayBuffer; paramExport: string; log: string[]; ms: number }
  | { type: 'done'; id: number; ok: false; error: string; log: string[]; ms: number };
