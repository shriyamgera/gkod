// Failures the page tells apart by their message; the worker and the client both use them.
export const TIMEOUT_MESSAGE = 'This took too long and was stopped.';
export const CRASH_MESSAGE = 'The compiler stopped unexpectedly. Try again.';
export const LOAD_MESSAGE = 'The compiler could not be loaded. Check your connection and try again.';
export const CANCEL_MESSAGE = 'The compile was cancelled.';

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
