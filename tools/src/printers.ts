import type { Bed } from '@gkod/checks';

// Build volumes in mm (X x Y x Z), from each maker's own spec page, checked 26 Nov 2026.
export const PRINTERS: Record<string, { name: string; bed: Bed }> = {
  kobra2neo: { name: 'Anycubic Kobra 2 Neo', bed: { x: 220, y: 220, z: 250 } },
  p1s: { name: 'Bambu Lab P1S', bed: { x: 256, y: 256, z: 256 } },
  a1: { name: 'Bambu Lab A1', bed: { x: 256, y: 256, z: 256 } },
  ender3v2: { name: 'Creality Ender-3 V2', bed: { x: 220, y: 220, z: 250 } },
  mk4: { name: 'Original Prusa MK4', bed: { x: 250, y: 210, z: 220 } },
};

export const DEFAULT_PRINTER = 'kobra2neo';
