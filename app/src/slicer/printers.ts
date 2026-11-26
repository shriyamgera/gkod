import type { Bed } from '@gkod/checks';
import { END_BEGINS, START_DONE } from './postprocess';

export type Printer = { id: string; name: string; bed: Bed; source: string; device: unknown /* the Kiri device JSON we build */ };

/** PLA only. Every printer prints with these; the G-code check holds them to PLA_LIMITS. */
export const PLA = { nozzle: 205, bed: 60 };

export const DEFAULT_PRINTER_ID = 'anycubic-kobra-2-neo';

type Facts = {
  id: string;
  name: string;
  bed: Bed;
  // where the bed size was checked
  source: string;
  // where the start and end code were taken from
  gcodeSource: string;
  extrudeAbs: boolean;
  retractMm: number;
  // {nozzle}, {bed} and {depth} are filled in by our code
  start: string[];
  end: string[];
};

const ANYCUBIC_SLICER = 'https://github.com/ANYCUBIC-3D/AnycubicSlicerNext/blob/6103ed8b511609658d00d0538cc7f0609cdb57da/resources/profiles/Anycubic/machine';
const CURA = 'https://github.com/Ultimaker/Cura/blob/1a221ec29a86960d16a412940becc1f63534c41f/resources/definitions';

// Anycubic Kobra 2 Neo. Bed 220 x 220 mm, 250 mm high: X_BED_SIZE, Y_BED_SIZE and Z_MAX_POS in Anycubic's own
// firmware source (below), and printable_area and printable_height in Anycubic's own slicer profile. Anycubic's
// product page (store.anycubic.com/products/kobra-2-neo) refused automated reading (HTTP 429), so it was not used.
// Start and end code: Anycubic Slicer Next, "Anycubic Kobra 2 Neo 0.4 nozzle" (AGPL-3.0); OrcaSlicer has the same
// text at commit d42123d2. Only the temperatures are ours.
const kobra2Neo: Facts = {
  id: 'anycubic-kobra-2-neo',
  name: 'Anycubic Kobra 2 Neo',
  bed: { x: 220, y: 220, z: 250 },
  source: 'https://github.com/ANYCUBIC-3D/Kobra2_Neo/blob/972d34e4173e14be2d81b9e6d35e9bc9b372be5f/Marlin/Configuration.h',
  gcodeSource: `${ANYCUBIC_SLICER}/Anycubic%20Kobra%202%20Neo%200.4%20nozzle.json`,
  extrudeAbs: false,
  retractMm: 2.5,
  start: [
    'G21 ; metric values',
    'G90 ; use absolute coordinates',
    'M83 ; extruder relative mode',
    'M104 S{nozzle} ; set extruder temp',
    'M140 S{bed} ; set bed temp',
    'G28; move X/Y/Z to min endstops',
    'M420 S1',
    'M300 S1318 P266',
    'G1 Z5 F5000 ; lift nozzle',
    'G1 X0 Y0  F3000',
    'G1 Z0.3; lift nozzle a bit',
    'G92 E0 ; zero after lift',
    'G1 X10 Y5 F1800 ; move to purge line start position',
    'M190 S{bed} ; wait for bed temp',
    'M109 S{nozzle} ; wait for extruder temp',
    'G1 X60 Y5 E20 F500 ; Extrude 20mm of filament in a 5cm line. ',
    'G92 E0 ; zero the extruded length again ',
    'G1 E-4.5 F4000 ; Retract a little ',
    'G92 E0 ; zero the extruded length again',
    'G1 X120 F4000 ; Quickly wipe away from the filament line',
    'M117 Printing... ; Display status message',
  ],
  end: [
    'M140 S0; Heatbed off',
    'M107; Fan off ',
    'G91; relative positioning ',
    'M83 ; extruder relative mode',
    'G1 E-3 F3000 ;retract the filament a bit before lifting the nozzle, to release some of the pressure',
    'G1 Z+0.5 F3000 ;move Z up a bit and retract filament even more',
    'M104 S0; Extruder off',
    'G28 X Y;move X/Y to min endstops, so the head is out of the way',
    'G90; absolute positioning ',
    'G1 Y220 F3000',
    'M84 ;steppers off',
    'M300 S1318 P266',
  ],
};

// Anycubic Kobra 2. Bed 220 x 220 mm, 250 mm high, from Anycubic's own firmware source and slicer profile
// (Kiri:Moto's own profile says 200 x 200 mm, which is wrong). Start and end code: Anycubic Slicer Next,
// "Anycubic Kobra 2 0.4 nozzle" (AGPL-3.0). Only the temperatures are ours.
const kobra2: Facts = {
  id: 'anycubic-kobra-2',
  name: 'Anycubic Kobra 2',
  bed: { x: 220, y: 220, z: 250 },
  source: 'https://github.com/ANYCUBIC-3D/Kobra2/blob/ff6e73c8cff5ece6212a2eac38a7d2089ef0c3fd/source/Marlin/Configuration.h',
  gcodeSource: `${ANYCUBIC_SLICER}/Anycubic%20Kobra%202%200.4%20nozzle.json`,
  extrudeAbs: false,
  retractMm: 2,
  start: [
    'G90 ;Use absolute coordinates',
    'M83 ;Extruder relative mode',
    'M104 S{nozzle} ;Set extruder temp',
    'M140 S{bed} ;Set bed temp',
    'M190 S{bed} ;Wait for bed temp',
    'M109 S{nozzle} ;Wait for extruder temp',
    'G28 ;Move X/Y/Z to min endstops',
    'G1 Z0.28 ;Lift nozzle a bit',
    'G92 E0 ;Specify current extruder position as zero',
    'G1 Y3 F1800 ;Move Y to purge point',
    'G1 X60 E25 F500 ;Extrude 25mm of filament in a 5cm line',
    'G92 E0 ;Zero the extruded length again',
    'G1 E-2 F500 ;Retract a little',
    'G1 X70 F4000 ;Quickly wipe away from the filament line',
    'M117',
  ],
  end: [
    'M104 S0 ;Extruder off',
    'M140 S0 ;Heatbed off',
    'M107 ;Fan off',
    'G91 ;Relative positioning',
    'G1 E-5 F3000 ;Retract filament',
    'G1 Z+0.3 F3000 ;Lift print head',
    'G28 X0 F3000 ;Home X axis',
    'M84 ;Disable stepper motors',
  ],
};

// Creality Ender-3 V2. Bed 220 x 220 mm, 250 mm high: X_BED_SIZE, Y_BED_SIZE and Z_MAX_POS in Creality's own
// firmware source. Start and end code: Cura's "Creality Ender-3 / Ender-3 v2" (creality_ender3.def.json, with the
// end code of creality_base.def.json; LGPL-3.0). Cura writes the heating lines and M82 itself before its start
// code, so they are written out here; Cura's M105 temperature reports are left out. {machine_depth} is the bed depth.
const ender3v2: Facts = {
  id: 'creality-ender-3-v2',
  name: 'Creality Ender-3 V2',
  bed: { x: 220, y: 220, z: 250 },
  source: 'https://github.com/CrealityOfficial/Ender-3V2/blob/88a603b396d09607f4b25bf1bd1c5881092380c0/Marlin/Configuration.h',
  gcodeSource: `${CURA}/creality_ender3.def.json`,
  extrudeAbs: true,
  // a Bowden extruder; 5 mm is Creality's usual setting (OrcaSlicer's fdm_creality_common)
  retractMm: 5,
  start: [
    'M140 S{bed}',
    'M190 S{bed}',
    'M104 S{nozzle}',
    'M109 S{nozzle}',
    'M82 ;absolute extrusion mode',
    '; Ender 3 Custom Start G-code',
    'G92 E0 ; Reset Extruder',
    'G28 ; Home all axes',
    'G1 Z2.0 F3000 ; Move Z Axis up little to prevent scratching of Heat Bed',
    'G1 X0.1 Y20 Z0.3 F5000.0 ; Move to start position',
    'G1 X0.1 Y200.0 Z0.3 F1500.0 E15 ; Draw the first line',
    'G1 X0.4 Y200.0 Z0.3 F5000.0 ; Move to side a little',
    'G1 X0.4 Y20 Z0.3 F1500.0 E30 ; Draw the second line',
    'G92 E0 ; Reset Extruder',
    'G1 Z2.0 F3000 ; Move Z Axis up little to prevent scratching of Heat Bed',
    'G1 X5 Y20 Z0.3 F5000.0 ; Move over to prevent blob squish',
  ],
  end: [
    'G91 ;Relative positioning',
    'G1 E-2 F2700 ;Retract a bit',
    'G1 E-2 Z0.2 F2400 ;Retract and raise Z',
    'G1 X5 Y5 F3000 ;Wipe out',
    'G1 Z10 ;Raise Z more',
    'G90 ;Absolute positioning',
    '',
    'G1 X0 Y{depth} ;Present print',
    'M106 S0 ;Turn-off fan',
    'M104 S0 ;Turn-off hotend',
    'M140 S0 ;Turn-off bed',
    '',
    'M84 X Y E ;Disable all steppers but Z',
  ],
};

// Any other Marlin printer with at least a 220 x 220 mm bed. The height is kept to 200 mm to leave room.
// Start and end code: the Kobra 2 Neo code above without its Anycubic-only lines (M420 levelling and M300 beeps).
const other: Facts = {
  id: 'other-220-marlin',
  name: 'Other printer, 220 x 220 mm, Marlin',
  bed: { x: 220, y: 220, z: 200 },
  source: kobra2Neo.gcodeSource,
  gcodeSource: kobra2Neo.gcodeSource,
  extrudeAbs: false,
  retractMm: 2,
  start: kobra2Neo.start.filter((line) => !/^M(420|300)\b/.test(line)),
  end: kobra2Neo.end.filter((line) => !/^M300\b/.test(line)),
};

// Not offered: Bambu Lab A1 and P1S, and Prusa MK4. Their makers' start code moves outside the bed (the A1 wipes
// at X -48, the MK4 purges at Y -4) and the Bambu code saves settings with M500. Our check refuses all of these.
const facts: Facts[] = [kobra2Neo, kobra2, ender3v2, other];

function fill(lines: string[], bed: Bed): string[] {
  return lines.map((line) =>
    line
      .replaceAll('{nozzle}', String(PLA.nozzle))
      .replaceAll('{bed}', String(PLA.bed))
      .replaceAll('{depth}', String(bed.y)),
  );
}

// Kiri:Moto's FDM device format. Kiri writes no fan, progress or layer lines of its own; we add the fan ourselves.
function kiriDevice(f: Facts) {
  return {
    mode: 'FDM',
    deviceName: f.name,
    internal: 0,
    new: false,
    bedWidth: f.bed.x,
    bedDepth: f.bed.y,
    maxHeight: f.bed.z,
    bedHeight: 2.5,
    bedRound: false,
    bedBelt: false,
    originCenter: false,
    fwRetract: false,
    filamentSource: 'direct',
    deviceZMax: 0,
    gcodeTime: 1,
    extrudeAbs: f.extrudeAbs,
    gcodePre: [...fill(f.start, f.bed), START_DONE],
    gcodePost: [END_BEGINS, ...fill(f.end, f.bed)],
    gcodeFan: [],
    gcodeTrack: [],
    gcodeLayer: [],
    gcodeFeature: [],
    gcodeChange: [],
    gcodeProc: '',
    gcodeFExt: 'gcode',
    extruders: [{ extFilament: 1.75, extNozzle: 0.4, extOffsetX: 0, extOffsetY: 0 }],
    extras: {},
    profiles: [],
  };
}

export type KiriDevice = ReturnType<typeof kiriDevice>;

export const printers: Printer[] = facts.map((f) => ({
  id: f.id,
  name: f.name,
  bed: { ...f.bed },
  source: f.source,
  device: kiriDevice(f),
}));

/** Everything our code knows about a printer, or undefined for an unknown id. */
export function printerFacts(id: string): (Facts & { device: KiriDevice }) | undefined {
  const f = facts.find((item) => item.id === id);
  return f && { ...f, device: kiriDevice(f) };
}

export function findPrinter(id: string): Printer | undefined {
  return printers.find((printer) => printer.id === id);
}
