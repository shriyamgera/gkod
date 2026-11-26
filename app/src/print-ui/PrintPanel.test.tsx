import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { type Printer, printers as shipped } from '../slicer/printers';
import { FIX_FIRST, NO_SHAPE, WAIT_FOR_CHECKS } from './format';
import { PrintPanel, type PrintPanelProps } from './PrintPanel';

const printer = (id: string, name: string, x: number, y: number, z: number): Printer => ({
  id,
  name,
  bed: { x, y, z },
  source: '',
  device: {},
});
const printers = [
  printer('anycubic-kobra-2-neo', 'Anycubic Kobra 2 Neo', 220, 220, 250),
  printer('bambu-lab-a1', 'Bambu Lab A1', 256, 256, 256),
  printer('prusa-mk4', 'Prusa MK4', 250, 210, 220),
];

const stl = new Uint8Array([1, 2, 3, 4]).buffer;
const neverSlice: PrintPanelProps['slice'] = () => new Promise(() => {});

const panel = (props: Partial<PrintPanelProps> = {}) =>
  renderToStaticMarkup(
    <PrintPanel
      stl={stl}
      title="Phone stand"
      supports={false}
      onSupportsChange={() => {}}
      checksOk
      slice={neverSlice}
      printers={printers}
      {...props}
    />,
  );
const visible = (html: string) =>
  html
    .replace(/<p class="visually-hidden"[^>]*>.*?<\/p>/, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/[ \n\t]+/g, ' ');
const sliceButton = (html: string) => /<button[^>]*>Slice for my printer<\/button>/.exec(html)?.[0] ?? '';
const selected = (html: string) => /<option value="([^"]+)" selected="">/.exec(html)?.[1];
const radio = (html: string, value: string) => new RegExp(`<input type="radio"[^>]*value="${value}"[^>]*>`).exec(html)?.[0] ?? '';

describe('PrintPanel', () => {
  it('starts on the Kobra 2 Neo with normal quality, 15% infill and its bed size', () => {
    const html = panel();
    expect(html).toContain('<h2');
    expect(visible(html)).toContain('Print');
    expect(html.indexOf('Anycubic Kobra 2 Neo')).toBeLessThan(html.indexOf('Bambu Lab A1'));
    expect(html).toMatch(/<option value="anycubic-kobra-2-neo" selected="">/);
    expect(visible(html)).toContain('220 x 220 x 250 mm bed, PLA only');
    expect(radio(html, 'normal')).toContain('checked=""');
    expect(radio(html, 'fine')).not.toContain('checked');
    expect(html).toMatch(/<option value="15" selected="">15%<\/option>/);
    expect(visible(html)).toContain('0.12 mm layers, slower');
  });

  it('puts the Kobra 2 Neo first in the real printer list and chooses it', () => {
    const html = panel({ printers: shipped });
    expect(/<option value="([^"]+)"/.exec(html)?.[1]).toBe('anycubic-kobra-2-neo');
    expect(selected(html)).toBe('anycubic-kobra-2-neo');
    expect(html).toContain('Other printer, 220 x 220 mm, Marlin');
  });

  it('offers the four infill amounts', () => {
    const html = panel();
    for (const value of [10, 15, 20, 30]) expect(html).toContain(`<option value="${value}"`);
  });

  it('shows the printer the page chose, and falls back to the Kobra 2 Neo for an unknown one', () => {
    expect(panel({ printerId: 'prusa-mk4' })).toContain('250 x 210 x 220 mm bed');
    expect(selected(panel({ printerId: 'gone-printer' }))).toBe('anycubic-kobra-2-neo');
    expect(selected(panel({ printers: printers.slice(1) }))).toBe('bambu-lab-a1');
  });

  it('mirrors the version’s supports choice in the checkbox', () => {
    expect(panel({ supports: true })).toMatch(/<input[^>]*type="checkbox"[^>]*checked=""/);
    expect(panel({ supports: false })).not.toMatch(/type="checkbox"[^>]*checked=""/);
  });

  it('turns the slice button on once there is a shape that passes the checks', () => {
    const html = panel();
    expect(sliceButton(html)).toContain('aria-disabled="false"');
    expect(sliceButton(html)).not.toContain('aria-describedby');
  });

  it('keeps the slice button in view but off, with the reason beside it', () => {
    const cases: [Partial<PrintPanelProps>, string][] = [
      [{ stl: null }, NO_SHAPE],
      [{ checksOk: null }, WAIT_FOR_CHECKS],
      [{ checksOk: false }, FIX_FIRST],
    ];
    for (const [props, reason] of cases) {
      const html = panel(props);
      const button = sliceButton(html);
      expect(button).toContain('aria-disabled="true"');
      const id = /aria-describedby="([^"]+)"/.exec(button)?.[1];
      expect(html).toContain(`<p id="${id}" class="print-note">${reason}</p>`);
    }
    expect(FIX_FIRST).toBe('Fix the problems above first, or choose Print with supports.');
  });

  it('says nothing aloud and shows no result before the first slice', () => {
    const html = panel();
    expect(/aria-live="polite">(.*?)<\/p>/.exec(html)?.[1]).toBe('');
    expect(html).not.toContain('Download G-code');
  });
});
