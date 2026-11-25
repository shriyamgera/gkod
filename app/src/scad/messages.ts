export type WorkerRequest = { id: number; source: string; overrides: Record<string, number> };

export type WorkerReply =
  // sent once the compiler is loaded and the compile is about to run, so loading does not count against the time limit
  | { type: 'start'; id: number }
  | { type: 'done'; id: number; ok: true; stl: ArrayBuffer; paramExport: string; log: string[]; ms: number }
  | { type: 'done'; id: number; ok: false; error: string; log: string[]; ms: number };
