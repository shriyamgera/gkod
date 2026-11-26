import type { GcodeReport } from '@gkod/checks';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { Printer } from '../slicer/printers';
import type { SliceResult, SliceSettings } from '../slicer/types';
import { PrintOutcome, phaseAnnouncement, UNSAFE } from './PrintOutcome';
import { type Phase, phaseFrom, problemLine, SETTINGS_CHANGED, SHAPE_CHANGED, type Sliced, staleNote } from './run';

const kobra: Printer = {
  id: 'anycubic-kobra-2-neo',
  name: 'Anycubic Kobra 2 Neo',
  bed: { x: 220, y: 220, z: 250 },
  source: '',
  device: {},
};
const stl = new Uint8Array([1, 2, 3, 4]).buffer;
const visible = (html: string) =>
  html
    .replace(/<[^>]+>/g, ' ')
    .replace(/[ \n\t]+/g, ' ');

const settings: SliceSettings = { printerId: 'anycubic-kobra-2-neo', quality: 'normal', infill: 15, supports: false };
const job: Sliced = { stl, settings, printer: kobra };

const stats: GcodeReport['stats'] = {
  lines: 41000,
  moves: 39000,
  maxX: 150,
  maxY: 150,
  maxZ: 103.4,
  minZ: 0.2,
  nozzle: [205, 0],
  bed: [60, 0],
  fanOnLayer: 2,
  extruderMode: 'absolute',
};
const safe: GcodeReport = { ok: true, problems: [], stats };
const unsafe: GcodeReport = {
  ok: false,
  problems: [
    { line: 1204, text: 'G1 X231.5 Y40.2 E12.3', reason: 'Moves outside the bed: X 231.5 mm, the printer allows 0 to 220 mm.' },
    { line: 88214, text: 'M500', reason: 'M500 saves settings to the printer’s memory, which a print file must never do.' },
  ],
  stats,
};
const finished: Extract<SliceResult, { ok: true }> = {
  ok: true,
  gcode: new Blob(['G28\n']),
  seconds: 6000,
  filamentMm: 12400,
  layers: 517,
  ms: 3240,
  safety: safe,
};

const outcome = (phase: Phase, stale: string | null = null) =>
  renderToStaticMarkup(
    <PrintOutcome phase={phase} stale={stale} fileName="phone_stand_kobra2neo.gcode" onStop={() => {}} onDownload={() => {}} />,
  );

describe('PrintOutcome', () => {
  it('shows progress as a bar with the percentage in words, and a Stop button', () => {
    const html = outcome({ kind: 'slicing', percent: 42, sliced: job });
    expect(html).toContain('role="progressbar"');
    expect(html).toContain('aria-valuenow="42"');
    expect(visible(html)).toContain('Slicing 42%');
    expect(html).toMatch(/<button[^>]*>Stop<\/button>/);
  });

  it('gives the time as an estimate, the filament in metres, the layers and the download', () => {
    const html = outcome({ kind: 'done', sliced: job, result: finished });
    const text = visible(html);
    expect(text).toContain('About 1 h 40 min (estimate, not exact)');
    expect(text).toContain('12.4 m of filament');
    expect(text).toContain('517 layers');
    expect(text).toContain('Passed our safety check. PLA, nozzle 205 °C, bed 60 °C.');
    expect(html).toMatch(/<button[^>]*>Download G-code<svg/);
    expect(text).toContain('phone_stand_kobra2neo.gcode, sliced on this device in 3.2 s');
  });

  it('never shows grams, because flow is not calibrated yet', () => {
    const text = visible(outcome({ kind: 'done', sliced: job, result: finished }));
    expect(text).not.toMatch(/\d\s?g\b|gram/i);
  });

  it('marks a result as out of date and takes the download away once anything changed', () => {
    const html = outcome({ kind: 'done', sliced: job, result: finished }, SETTINGS_CHANGED);
    expect(visible(html)).toContain('Settings changed. Slice again.');
    expect(html).toContain('data-stale="true"');
    expect(html).not.toContain('Download G-code');
  });

  it('never offers a file that failed the safety check, and names the first problem in words', () => {
    const html = outcome({ kind: 'unsafe', sliced: job, report: unsafe });
    const text = visible(html);
    expect(text).toContain('This file failed our safety check and was not offered for download.');
    expect(text).toContain('Line 1204: Moves outside the bed: X 231.5 mm, the printer allows 0 to 220 mm.');
    expect(html).toMatch(/<button[^>]*aria-expanded="false"[^>]*>Show details<\/button>/);
    expect(html).toMatch(/<ul[^>]*hidden=""/);
    expect(html).toContain('G1 X231.5 Y40.2 E12.3');
    expect(html).not.toContain('Download G-code');
  });

  it('says why slicing failed, with no download', () => {
    const html = outcome({ kind: 'failed', sliced: job, error: 'Slicing took longer than 2 minutes and was stopped.' });
    expect(visible(html)).toContain('Could not slice the part');
    expect(visible(html)).toContain('Slicing took longer than 2 minutes and was stopped.');
    expect(html).not.toContain('Download G-code');
  });

  it('hides an old problem once the settings or the part changed', () => {
    expect(outcome({ kind: 'unsafe', sliced: job, report: unsafe }, SHAPE_CHANGED)).toBe('');
    expect(outcome({ kind: 'failed', sliced: job, error: 'x' }, SETTINGS_CHANGED)).toBe('');
  });

  it('says when slicing was stopped', () => {
    expect(visible(outcome({ kind: 'stopped' }))).toContain('Slicing stopped.');
    expect(outcome({ kind: 'idle' })).toBe('');
  });

  it('reads out each settled state once, in short sentences', () => {
    expect(phaseAnnouncement({ kind: 'slicing', percent: 10, sliced: job }, null)).toBe('Slicing for Anycubic Kobra 2 Neo.');
    expect(phaseAnnouncement({ kind: 'done', sliced: job, result: finished }, null)).toBe(
      'Sliced. About 1 h 40 min, 12.4 m of filament. Ready to download.',
    );
    expect(phaseAnnouncement({ kind: 'done', sliced: job, result: finished }, SETTINGS_CHANGED)).toBe(SETTINGS_CHANGED);
    expect(phaseAnnouncement({ kind: 'unsafe', sliced: job, report: unsafe }, null)).toBe(
      `${UNSAFE} Line 1204: Moves outside the bed: X 231.5 mm, the printer allows 0 to 220 mm.`,
    );
    expect(phaseAnnouncement({ kind: 'stopped' }, null)).toBe('Slicing stopped.');
  });
});

describe('phaseFrom', () => {
  it('offers the file only when the slice worked and the safety check passed', () => {
    expect(phaseFrom(finished, job).kind).toBe('done');
    expect(phaseFrom({ ...finished, safety: unsafe }, job).kind).toBe('unsafe');
  });

  it('shows the safety report when the client refused the file', () => {
    expect(phaseFrom({ ok: false, error: 'Failed the safety check', ms: 10, safety: unsafe }, job)).toMatchObject({
      kind: 'unsafe',
      report: unsafe,
    });
  });

  it('passes on the slicer’s own reason, or a plain one when it gave none', () => {
    expect(phaseFrom({ ok: false, error: 'Timed out', ms: 120000 }, job)).toMatchObject({ kind: 'failed', error: 'Timed out' });
    expect(phaseFrom({ ok: false, error: '', ms: 5 }, job)).toMatchObject({
      kind: 'failed',
      error: 'The slicer stopped without a reason.',
    });
  });
});

describe('staleNote', () => {
  it('keeps a result while nothing changed, even when the same shape was compiled again', () => {
    expect(staleNote(job, stl, { ...settings })).toBeNull();
    expect(staleNote(job, new Uint8Array([1, 2, 3, 4]).buffer, settings)).toBeNull();
  });

  it('says the part changed when the shape is different or gone', () => {
    expect(staleNote(job, new Uint8Array([1, 2, 3, 5]).buffer, settings)).toBe(SHAPE_CHANGED);
    expect(staleNote(job, new Uint8Array([1, 2, 3]).buffer, settings)).toBe(SHAPE_CHANGED);
    expect(staleNote(job, null, settings)).toBe(SHAPE_CHANGED);
  });

  it('says the settings changed when any one of them did', () => {
    const changes: Partial<SliceSettings>[] = [
      { printerId: 'prusa-mk4' },
      { quality: 'fine' },
      { infill: 30 },
      { supports: true },
    ];
    for (const change of changes) expect(staleNote(job, stl, { ...settings, ...change })).toBe(SETTINGS_CHANGED);
  });
});

describe('problemLine', () => {
  it('turns a problem into one sentence with its line number', () => {
    expect(problemLine(unsafe.problems[0]!)).toBe('Line 1204: Moves outside the bed: X 231.5 mm, the printer allows 0 to 220 mm.');
    expect(problemLine(unsafe.problems[1]!)).toBe(
      'Line 88214: M500 saves settings to the printer’s memory, which a print file must never do.',
    );
    expect(problemLine({ line: 7, text: 'G1 X5', reason: 'moves before homing' })).toBe('Line 7: Moves before homing.');
    expect(problemLine({ line: 0, text: '', reason: 'The file has no moves.' })).toBe('The file has no moves.');
  });
});
