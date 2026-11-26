import type { CheckResult, Report } from '@gkod/checks';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { CheckList } from './CheckList';

const passed: CheckResult[] = [
  { id: 'closed', ok: true, title: 'Solid, no holes', detail: 'The surface is closed.' },
  { id: 'fits-bed', ok: true, title: 'Fits your printer (256 mm bed)', detail: '' },
  { id: 'flat-base', ok: true, title: 'Sits flat on the bed', detail: '' },
  { id: 'overhang', ok: true, title: 'No steep overhangs', detail: '' },
];

const sag: CheckResult = {
  id: 'overhang',
  ok: false,
  title: 'No steep overhangs',
  detail: 'The part underneath at 60 mm would sag while printing.',
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

describe('CheckList', () => {
  it('gives every check a word as well as an icon, in the order they ran', () => {
    const html = renderToStaticMarkup(<CheckList report={report(sag)} />);
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain('What we checked');
    const words = [...html.matchAll(/<span class="check-word">(?:<svg.*?<\/svg>)(\w+)<\/span>/g)].map((m) => m[1]);
    expect(words).toEqual(['OK', 'OK', 'OK', 'Problem']);
    expect(html).toContain('Fits your printer (256 mm bed)');
    expect(html).toContain('Checked on this device in 3 ms');
  });

  it('adds the sentence under a problem only, so the passed lines stay short', () => {
    const html = renderToStaticMarkup(<CheckList report={report(sag)} />);
    expect(html).toContain(sag.detail);
    expect(html).not.toContain('The surface is closed.');
  });

  it('shows nothing before there is a report', () => {
    expect(renderToStaticMarkup(<CheckList report={null} />)).toBe('');
  });
});
