import type { CheckResult, Report } from '@gkod/checks';
import { describe, expect, it } from 'vitest';
import {
  blockReason,
  checksAllowSlicing,
  FIX_FIRST,
  formatDuration,
  formatFilament,
  formatTemps,
  gcodeFileName,
  NO_SHAPE,
  printerSlug,
  WAIT_FOR_CHECKS,
} from './format';

describe('formatDuration', () => {
  it('rounds to the minute and says it is about that long', () => {
    expect(formatDuration(6000)).toBe('About 1 h 40 min');
    expect(formatDuration(1200)).toBe('About 20 min');
    expect(formatDuration(89)).toBe('About 1 min');
    expect(formatDuration(3600)).toBe('About 1 h');
    expect(formatDuration(3629)).toBe('About 1 h');
    expect(formatDuration(3631)).toBe('About 1 h 1 min');
    expect(formatDuration(3570)).toBe('About 1 h');
    expect(formatDuration(36000 + 300)).toBe('About 10 h 5 min');
  });

  it('never says "about 0 min"', () => {
    expect(formatDuration(0)).toBe('Under 1 min');
    expect(formatDuration(29)).toBe('Under 1 min');
  });

  it('says the time is not known for a broken number', () => {
    expect(formatDuration(Number.NaN)).toBe('Time not known');
    expect(formatDuration(-5)).toBe('Time not known');
    expect(formatDuration(Number.POSITIVE_INFINITY)).toBe('Time not known');
  });
});

describe('formatFilament', () => {
  it('gives metres with one decimal', () => {
    expect(formatFilament(12400)).toBe('12.4 m');
    expect(formatFilament(1068.82)).toBe('1.1 m');
    expect(formatFilament(250)).toBe('0.3 m');
    expect(formatFilament(203000)).toBe('203.0 m');
  });

  it('never says 0.0 m', () => {
    expect(formatFilament(0)).toBe('Under 0.1 m');
    expect(formatFilament(49)).toBe('Under 0.1 m');
    expect(formatFilament(50)).toBe('0.1 m');
  });

  it('says not known for a broken number', () => {
    expect(formatFilament(Number.NaN)).toBe('Not known');
    expect(formatFilament(-1)).toBe('Not known');
  });
});

describe('formatTemps', () => {
  it('names one temperature, or the range, and leaves out heaters turned off', () => {
    expect(formatTemps([205, 205, 0])).toBe('205\u00a0°C');
    expect(formatTemps([210, 200, 205])).toBe('200 to 210\u00a0°C');
    expect(formatTemps([0])).toBe('');
    expect(formatTemps([])).toBe('');
  });
});

describe('file names', () => {
  it('uses the model name of the printer without the brand', () => {
    expect(printerSlug('Anycubic Kobra 2 Neo')).toBe('kobra2neo');
    expect(printerSlug('Bambu Lab A1')).toBe('a1');
    expect(printerSlug('Bambu Lab P1S')).toBe('p1s');
    expect(printerSlug('Creality Ender 3 V2')).toBe('ender3v2');
    expect(printerSlug('Prusa MK4')).toBe('mk4');
    expect(printerSlug('Other printer, 220 x 220 mm, Marlin')).toBe('printer');
    expect(printerSlug('')).toBe('printer');
  });

  it('names the file after the part, the version and the printer', () => {
    expect(gcodeFileName('Phone stand', 'Anycubic Kobra 2 Neo')).toBe('phone_stand_kobra2neo.gcode');
    expect(gcodeFileName('Phone stand', 'Anycubic Kobra 2 Neo', 3)).toBe('phone_stand_v3_kobra2neo.gcode');
    expect(gcodeFileName('Câble clip, 6 mm!', 'Prusa MK4', 1)).toBe('cable_clip_6_mm_v1_mk4.gcode');
    expect(gcodeFileName('!!!', 'Bambu Lab A1')).toBe('part_a1.gcode');
  });
});

const pass = (id: CheckResult['id']): CheckResult => ({ id, ok: true, title: id, detail: '' });
const fail = (id: CheckResult['id']): CheckResult => ({ id, ok: false, title: id, detail: `${id} failed` });

function report(...failed: CheckResult['id'][]): Report {
  const ids: CheckResult['id'][] = ['closed', 'fits-bed', 'flat-base', 'overhang'];
  return {
    ok: failed.length === 0,
    results: ids.map((id) => (failed.includes(id) ? fail(id) : pass(id))),
    ms: 2,
    stats: { triangles: 12, volume: 1000, size: [10, 10, 10], min: [0, 0, 0] },
  };
}

describe('checksAllowSlicing', () => {
  it('waits for a report', () => {
    expect(checksAllowSlicing(null, false)).toBeNull();
  });

  it('allows slicing when every check passed', () => {
    expect(checksAllowSlicing(report(), false)).toBe(true);
  });

  it('allows an overhang only when supports are on', () => {
    expect(checksAllowSlicing(report('overhang'), false)).toBe(false);
    expect(checksAllowSlicing(report('overhang'), true)).toBe(true);
  });

  it('never lets supports carry a problem they cannot fix', () => {
    expect(checksAllowSlicing(report('fits-bed'), true)).toBe(false);
    expect(checksAllowSlicing(report('closed', 'overhang'), true)).toBe(false);
  });
});

describe('blockReason', () => {
  it('names why the slice button is off', () => {
    expect(blockReason(false, true)).toBe(NO_SHAPE);
    expect(blockReason(true, null)).toBe(WAIT_FOR_CHECKS);
    expect(blockReason(true, false)).toBe(FIX_FIRST);
    expect(blockReason(true, true)).toBeNull();
  });
});
