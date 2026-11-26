import type { GcodeReport } from '@gkod/checks';
import type { Printer } from '../slicer/printers';
import type { SliceResult, SliceSettings } from '../slicer/types';

export type Sliced = { stl: ArrayBuffer; settings: SliceSettings; printer: Printer };
export type Finished = Extract<SliceResult, { ok: true }>;

export type Phase =
  | { kind: 'idle' }
  | { kind: 'slicing'; percent: number; sliced: Sliced }
  | { kind: 'done'; sliced: Sliced; result: Finished }
  | { kind: 'unsafe'; sliced: Sliced; report: GcodeReport }
  | { kind: 'failed'; sliced: Sliced; error: string }
  | { kind: 'stopped' };

/** A file is offered only when the slice worked and its safety check passed. */
export function phaseFrom(result: SliceResult, sliced: Sliced): Phase {
  if (result.ok) {
    return result.safety.ok ? { kind: 'done', sliced, result } : { kind: 'unsafe', sliced, report: result.safety };
  }
  if (result.safety && !result.safety.ok) return { kind: 'unsafe', sliced, report: result.safety };
  return { kind: 'failed', sliced, error: result.error || 'The slicer stopped without a reason.' };
}

export const SHAPE_CHANGED = 'The part changed. Slice again.';
export const SETTINGS_CHANGED = 'Settings changed. Slice again.';

/** Why a finished slice no longer matches what is on screen, or null when it still does. */
export function staleNote(sliced: Sliced, stl: ArrayBuffer | null, settings: SliceSettings): string | null {
  if (!stl || !sameBytes(sliced.stl, stl)) return SHAPE_CHANGED;
  const a = sliced.settings;
  const same =
    a.printerId === settings.printerId &&
    a.quality === settings.quality &&
    a.infill === settings.infill &&
    a.supports === settings.supports;
  return same ? null : SETTINGS_CHANGED;
}

// The same code compiled again gives a new buffer with the same bytes; that is not a new shape.
function sameBytes(a: ArrayBuffer, b: ArrayBuffer): boolean {
  if (a === b) return true;
  if (a.byteLength !== b.byteLength) return false;
  const x = new Uint8Array(a);
  const y = new Uint8Array(b);
  for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) return false;
  return true;
}

/** "Line 1204: Moves outside the bed." A problem with the whole file has no line. */
export function problemLine(problem: GcodeReport['problems'][number]): string {
  const reason = problem.reason.trim();
  const capital = `${reason.charAt(0).toUpperCase()}${reason.slice(1)}`;
  const sentence = /[.!?]$/.test(capital) ? capital : `${capital}.`;
  return problem.line > 0 ? `Line ${problem.line}: ${sentence}` : sentence;
}
