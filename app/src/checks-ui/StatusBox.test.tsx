import type { CheckResult, Report } from '@gkod/checks';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { StatusBox } from './StatusBox';
import { announcement, fixedNote, fixLabel, fixRequest, overhangMark, readyLine, viewerMark } from './wording';

const passed: CheckResult[] = [
  { id: 'closed', ok: true, title: 'Solid, no holes', detail: '' },
  { id: 'fits-bed', ok: true, title: 'Fits your printer (256 mm bed)', detail: '' },
  { id: 'flat-base', ok: true, title: 'Sits flat on the bed', detail: '' },
  { id: 'overhang', ok: true, title: 'No steep overhangs', detail: '' },
];

const sag: CheckResult = {
  id: 'overhang',
  ok: false,
  title: 'No steep overhangs',
  detail: 'The part underneath at 60 mm would sag while printing.',
  fix: 'Change the design so no surface underneath leans more than 45 degrees from vertical; keep every named size.',
  triangles: [5, 6, 7, 8],
  at: [15, 10, 62],
};

const tooBig: CheckResult = {
  id: 'fits-bed',
  ok: false,
  title: 'Fits your printer (256 mm bed)',
  detail: 'It is 300 mm long, longer than the 256 mm bed.',
  fix: 'Make the part fit inside 256 by 256 by 256 mm; keep the other named sizes.',
};

function report(...failed: CheckResult[]): Report {
  const results = passed.map((check) => failed.find((f) => f.id === check.id) ?? check);
  return {
    ok: failed.length === 0,
    results,
    ms: 3.4,
    stats: { triangles: 24, volume: 44000, size: [80, 20, 80], min: [0, 0, 2] },
  };
}

type BoxProps = Parameters<typeof StatusBox>[0];
const box = (props: Partial<BoxProps>) =>
  renderToStaticMarkup(<StatusBox report={null} busy={false} canFix onFix={() => {}} onSupports={() => {}} {...props} />);
// visible text only, without the hidden announcement
const visible = (html: string) => html.replace(/<p class="visually-hidden"[^>]*>.*?<\/p>/, '').replace(/<[^>]+>/g, ' ');
const said = (html: string) => /aria-live="polite">(.*?)<\/p>/.exec(html)?.[1] ?? '';
const button = (html: string, name: string) => new RegExp(`<button[^>]*>${name}</button>`).exec(html)?.[0] ?? '';

describe('StatusBox', () => {
  it('says quietly that it is checking before the first report', () => {
    const html = box({ busy: true });
    expect(visible(html)).toContain('Checking the shape');
    expect(html).not.toContain('<section');
  });

  it('shows nothing but an empty live region when there is no report and nothing running', () => {
    expect(visible(box({})).trim()).toBe('');
    expect(said(box({}))).toBe('');
  });

  it('says ready to print with one line built from the passed checks', () => {
    const html = box({ report: report() });
    expect(visible(html)).toContain('Ready to print');
    expect(visible(html)).toContain('Solid, fits your printer, sits flat and needs no supports.');
    expect(html).not.toContain('Fix it for me');
    expect(said(html)).toBe('Ready to print. Solid, fits your printer, sits flat and needs no supports.');
  });

  it('names one problem in a sentence, with Fix it for me and the supports choice for an overhang', () => {
    const html = box({ report: report(sag) });
    expect(visible(html)).toContain('One thing to fix');
    expect(visible(html)).toContain(sag.detail);
    expect(button(html, 'Fix it for me')).not.toContain('aria-disabled="true"');
    expect(button(html, 'Print with supports instead')).not.toBe('');
    expect(said(html)).toBe(`One thing to fix. ${sag.detail}`);
  });

  it('counts two problems, lists both, and offers no supports because supports cannot fix size', () => {
    const html = box({ report: report(tooBig, sag) });
    expect(visible(html)).toContain('2 things to fix');
    expect(html).toContain(`<li>${tooBig.detail}</li>`);
    expect(html).toContain(`<li>${sag.detail}</li>`);
    expect(html).not.toContain('Print with supports instead');
  });

  it('offers no supports for a problem other than an overhang', () => {
    expect(box({ report: report(tooBig) })).not.toContain('Print with supports instead');
  });

  it('keeps Fix it for me in view but turned off, with the reason, when it cannot be used', () => {
    const html = box({ report: report(sag), canFix: false });
    expect(button(html, 'Fix it for me')).toContain('aria-disabled="true"');
    expect(button(html, 'Fix it for me')).toMatch(/aria-describedby="[^"]+"/);
    expect(visible(html)).toContain('Fix it for me needs your Gemini key.');
    expect(box({ report: report(sag), canFix: false, noFixReason: 'Examples stay as they are.' })).toContain(
      'Examples stay as they are.',
    );
    expect(box({ report: report(sag), onFix: undefined })).toContain('Fix it for me needs your Gemini key.');
  });

  it('turns the buttons off while a fix is running or the shape is checked again', () => {
    const fixing = box({ report: report(sag), fixing: true });
    expect(button(fixing, 'Fixing')).toContain('aria-disabled="true"');
    expect(button(fixing, 'Print with supports instead')).toContain('aria-disabled="true"');
    expect(fixing).not.toContain('needs your Gemini key');

    const busy = box({ report: report(sag), busy: true });
    expect(button(busy, 'Fix it for me')).toContain('aria-disabled="true"');
    expect(busy).toContain('aria-busy="true"');
    expect(busy).toContain('data-on="true"');
  });

  it('keeps the last report on screen while checking again, and does not read it out a second time', () => {
    const html = box({ report: report(sag), busy: true });
    expect(visible(html)).toContain('One thing to fix');
    expect(said(html)).toBe(`One thing to fix. ${sag.detail}`);
  });

  it('says to turn on supports in the slicer once they are chosen, with a way back, and never looks like a pass', () => {
    const html = box({ report: report(sag), supportsChosen: true });
    expect(visible(html)).toContain('Needs supports');
    expect(visible(html)).toContain('Turn on supports in your slicer for the marked part that would sag.');
    expect(html).toContain('status-supports');
    expect(html).not.toContain('status-ok');
    expect(html).not.toContain('Fix it for me');
    expect(button(html, 'Print without supports')).not.toBe('');
    expect(said(html)).toMatch(/^Needs supports\. Turn on supports in your slicer/);
  });

  it('ignores the supports choice once a problem supports cannot carry turns up, or once nothing sags', () => {
    expect(visible(box({ report: report(tooBig, sag), supportsChosen: true }))).toContain('2 things to fix');
    expect(visible(box({ report: report(), supportsChosen: true }))).toContain('Ready to print');
  });
});

describe('wording', () => {
  it('builds the ready line from whatever passed', () => {
    expect(readyLine(report(tooBig))).toBe('Solid, sits flat and needs no supports.');
    expect(readyLine({ ...report(), results: [passed[0]!] })).toBe('Solid.');
  });

  it('reads out nothing before the first report', () => {
    expect(announcement(null, false)).toBe('');
  });

  it('asks the engine with the checks’ own instructions, never anything else', () => {
    expect(fixRequest(report(tooBig, sag))).toBe(`${tooBig.fix}\n${sag.fix}`);
  });

  it('labels the version a fix made by what it fixed', () => {
    expect(fixLabel(report(sag), report())).toBe('Fixed: steep overhang');
    expect(fixLabel(report(tooBig, sag), report())).toBe('Fixed: size for the bed and steep overhang');
    expect(fixLabel(report(sag), report(sag))).toBe('Tried to fix: steep overhang');
    expect(fixLabel(report(sag), report(tooBig))).toBe('Fixed: steep overhang');
    expect(fixLabel(report(sag), undefined)).toBe('Tried to fix: steep overhang');
  });

  it('says plainly whether the fix worked, and that the version it started from is kept', () => {
    expect(fixedNote(3, 2, report(sag), report())).toBe('Fixed. Version 3 is ready to print.');
    expect(fixedNote(3, 2, report(sag), report(sag))).toBe(
      'The fix did not work: version 3 still has a problem. Version 2 is kept under Changes.',
    );
    expect(fixedNote(2, 1, report(sag), report(tooBig, sag))).toContain('version 2 still has 2 problems');
    expect(fixedNote(3, 1, report(sag), report(tooBig))).toBe(
      'Version 3 fixes that, but has a new problem. Version 1 is kept under Changes.',
    );
    expect(fixedNote(2, 1, report(sag), undefined)).toBe('Version 2 is made, but it could not be checked.');
  });

  it('marks the overhang with its height above the bed', () => {
    expect(overhangMark(report(sag))).toEqual({
      triangles: [5, 6, 7, 8],
      at: [15, 10, 62],
      label: 'Would sag here',
      description: 'Steep overhang at 60 mm height',
    });
    expect(overhangMark({ ...report(sag), stats: { ...report().stats, min: [0, 0, 24.66] } })!.description).toBe(
      'Steep overhang at 37.3 mm height',
    );
    expect(overhangMark(report(tooBig))).toBeNull();
    expect(overhangMark(null)).toBeNull();
  });

  it('keeps marking the overhang once supports are chosen, as where they go', () => {
    expect(viewerMark(report(sag), false)).toEqual(overhangMark(report(sag)));
    expect(viewerMark(report(sag), true)).toEqual({ ...overhangMark(report(sag)), label: 'Needs supports here' });
    // supports cannot fix the size, so the box lists the overhang again and the viewer says it would sag
    expect(viewerMark(report(tooBig, sag), true)).toEqual(overhangMark(report(tooBig, sag)));
  });
});
