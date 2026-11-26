import type { GcodeReport } from '@gkod/checks';
import type { SliceSettings } from './types';

// Failures the page tells apart by their message; the worker and the client both use them.
export const TIMEOUT_MESSAGE = 'Slicing took too long and was stopped.';
export const CRASH_MESSAGE = 'The slicer stopped unexpectedly. Try again.';
export const LOAD_MESSAGE = 'The slicer could not be loaded. Check your connection and try again.';
export const CANCEL_MESSAGE = 'Slicing was stopped.';
export const SLICE_MESSAGE = 'The slicer could not slice this part.';
export const TOO_BIG_MESSAGE = 'This part is bigger than the printer’s bed.';
export const TOO_TALL_MESSAGE = 'This part is too tall for this printer, which needs room to lift the nozzle at the end.';
export const UNSAFE_MESSAGE = 'The G-code failed the safety check, so it is not offered for download.';

export type SliceRequest = { type: 'slice'; id: number; stl: ArrayBuffer; settings: SliceSettings };

export type SliceReply =
  // sent once the slicer is loaded and this slice begins, so loading does not count against the time limit
  | { type: 'start'; id: number }
  | { type: 'progress'; id: number; fraction: number }
  | {
      type: 'done';
      id: number;
      ok: true;
      gcode: Blob;
      seconds: number;
      filamentMm: number;
      layers: number;
      safety: GcodeReport;
    }
  | { type: 'done'; id: number; ok: false; error: string; detail?: string; safety?: GcodeReport };
