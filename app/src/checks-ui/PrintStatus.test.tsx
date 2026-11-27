import type { Report } from '@gkod/checks';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { PrintStatus } from './PrintStatus';
import type { FixHandle } from './useFix';

const sagging: Report = {
  ok: false,
  results: [
    { id: 'closed', ok: true, title: 'Solid, no holes', detail: '' },
    { id: 'fits-bed', ok: true, title: 'Fits your printer (256 mm bed)', detail: '' },
    { id: 'flat-base', ok: true, title: 'Sits flat on the bed', detail: '' },
    {
      id: 'overhang',
      ok: false,
      title: 'No steep overhangs',
      detail: 'The part underneath at 60 mm would sag while printing.',
      fix: 'Change the design so no surface underneath leans more than 45 degrees from vertical; keep every named size.',
      triangles: [1],
      at: [0, 0, 60],
    },
  ],
  ms: 1,
  stats: { triangles: 12, volume: 1000, size: [10, 10, 66], min: [0, 0, 0] },
};

const idle: FixHandle = {
  stage: null,
  note: '',
  failure: null,
  keyAsk: null,
  fixing: false,
  start: () => {},
  stop: () => {},
  closeKey: () => {},
  clear: () => {},
};

const render = (fix: Partial<FixHandle>) =>
  renderToStaticMarkup(
    <PrintStatus
      report={sagging}
      busy={false}
      fix={{ ...idle, ...fix }}
      onFix={() => {}}
      supportsChosen={false}
      onSupports={() => {}}
    />,
  );
const text = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');

describe('PrintStatus', () => {
  it('keeps an empty live region for the fix, so its first message is read out', () => {
    const html = render({});
    expect(html).toContain('<div class="fix-status"><p role="status"></p></div>');
    expect(html).not.toContain('Stop');
  });

  it('shows the fix stage with a Stop button, and the Fix button turned off', () => {
    const html = render({ stage: 'Writing the fix', fixing: true });
    expect(text(html)).toContain('Writing the fix Stop');
    expect(html).toMatch(/<button[^>]*aria-disabled="true"[^>]*>Fixing<\/button>/);
  });

  it('says what the fix did', () => {
    const note = 'The fix did not work: version 3 still has a problem. Version 2 is kept under Changes.';
    expect(text(render({ note }))).toContain(note);
  });

  it('asks for the key in place when there is none', () => {
    const html = render({ keyAsk: { engine: 'gemini' } });
    expect(html).toContain('aria-label="Gemini key"');
    expect(text(html)).toContain('Fix it for me uses your own free Gemini key');
  });

  it('asks for the pairing code instead when Claude Code is the engine', () => {
    const html = render({ keyAsk: { engine: 'claude-code' } });
    expect(html).toContain('aria-label="Pairing code"');
    expect(text(html)).toContain('Pair with the bridge on this Mac');
    expect(html).not.toContain('Gemini key');
  });

  it('names the engine that was busy', () => {
    const html = render({ failure: { problem: 'busy', message: 'Claude Code is already working on another part.', engineLabel: 'Claude Code' } });
    expect(text(html)).toContain('Claude Code is busy');
  });

  it('names a failure, says the part is unchanged and offers to try again', () => {
    const html = render({ failure: { problem: 'busy', message: 'Gemini is busy right now.' } });
    expect(html).toContain('role="alert"');
    expect(text(html)).toContain('Gemini is busy Gemini is busy right now. The part is as it was. Try again');
  });
});
