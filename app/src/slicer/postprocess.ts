// Fixes up Kiri:Moto's G-code one line at a time, as it streams out of the slicer:
// - states the extruder mode (M82 or M83) right after the start code, before the slicer's first extrusion
// - turns the part fan on from the second layer (Kiri leaves it off for most of the print) and drops any fan
//   line of the slicer's own between the start and end code
// Everything else is kept as it is.

import { END_BEGINS, START_DONE } from './printers';

export { END_BEGINS, START_DONE };

export const FAN_SPEED = 255;
// Kiri numbers layers from 0, so this is the second layer.
export const FAN_LAYER = 1;

const LAYER = /^;; --- layer (\d+) \(/;
const FAN = /^\s*M10[67](\s|;|$)/i;

export type PostOptions = { extrudeAbs: boolean };

export function createPostProcessor({ extrudeAbs }: PostOptions, emit: (line: string) => void) {
  let part: 'start' | 'body' | 'end' = 'start';
  let layers = 0;
  let fanOn = false;

  function line(raw: string) {
    const text = raw.endsWith('\r') ? raw.slice(0, -1) : raw;
    if (part === 'start') {
      emit(text);
      if (text.trim() === START_DONE) {
        part = 'body';
        emit(extrudeAbs ? 'M82 ; absolute extrusion for the sliced part' : 'M83 ; relative extrusion for the sliced part');
        emit('M107 ; part fan off for the first layer');
      }
      return;
    }
    if (part === 'body') {
      if (text.trim() === END_BEGINS) {
        part = 'end';
        emit(text);
        return;
      }
      if (FAN.test(text)) return;
      emit(text);
      const layer = LAYER.exec(text);
      if (layer) {
        layers++;
        if (Number(layer[1]) === FAN_LAYER) {
          emit(`M106 S${FAN_SPEED} ; part fan on from layer ${FAN_LAYER + 1}`);
          fanOn = true;
        }
      }
      return;
    }
    emit(text);
  }

  return {
    line,
    /** What was seen; a slice whose output lacks either marker is not used. */
    summary: () => ({ layers, fanOn, sawStart: part !== 'start', sawEnd: part === 'end' }),
  };
}

/** The extrusion mode Kiri uses: the device setting, unless the start code sets one (Kiri's own rule). */
export function kiriExtrudeAbs(device: { extrudeAbs: boolean; gcodePre: string[] }): boolean {
  let abs = device.extrudeAbs;
  let set = false;
  for (const raw of device.gcodePre) {
    const line = raw.trim();
    if (line.startsWith('M82')) {
      abs = true;
      set = true;
    } else if (line.startsWith('M83')) {
      abs = false;
      set = true;
    } else if (line.startsWith('G90') && !set) abs = true;
    else if (line.startsWith('G91') && !set) abs = false;
  }
  return abs;
}
