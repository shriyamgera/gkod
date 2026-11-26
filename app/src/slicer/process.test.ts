import { PLA_LIMITS } from '@gkod/checks';
import { describe, expect, it } from 'vitest';
import { kiriProcess } from './process';
import { DEFAULT_PRINTER_ID } from './printers';
import { type Infill, INFILLS, type SliceSettings } from './types';

const base: SliceSettings = { printerId: DEFAULT_PRINTER_ID, quality: 'normal', infill: 15, supports: false };

describe('kiriProcess', () => {
  it('uses 0.2 mm layers for normal and 0.12 mm for fine, with skins of the same thickness', () => {
    expect(kiriProcess(base)).toMatchObject({ sliceHeight: 0.2, firstSliceHeight: 0.2, sliceTopLayers: 4, sliceBottomLayers: 3 });
    expect(kiriProcess({ ...base, quality: 'fine' })).toMatchObject({
      sliceHeight: 0.12,
      firstSliceHeight: 0.2,
      sliceTopLayers: 7,
      sliceBottomLayers: 5,
    });
  });

  it('always uses grid infill between 10 and 30 percent', () => {
    for (const infill of INFILLS) {
      const process = kiriProcess({ ...base, infill });
      expect(process.sliceFillType).toBe('grid');
      expect(process.sliceFillSparse).toBe(infill / 100);
    }
  });

  it('turns supports on and off', () => {
    expect(kiriProcess(base).sliceSupportType).toBe('disabled');
    expect(kiriProcess({ ...base, supports: true }).sliceSupportType).toBe('automatic');
  });

  it('prints PLA inside the safe ranges, without arcs', () => {
    const process = kiriProcess(base);
    expect(process.outputTemp).toBeGreaterThanOrEqual(PLA_LIMITS.nozzleMin);
    expect(process.outputTemp).toBeLessThanOrEqual(PLA_LIMITS.nozzleMax);
    expect(process.outputBedTemp).toBeLessThanOrEqual(PLA_LIMITS.bedMax);
    expect(process.fdmArcEnabled).toBe(false);
    expect(process.outputRetractDist).toBe(2.5);
  });

  it('refuses settings outside the menus', () => {
    expect(() => kiriProcess({ ...base, printerId: 'bambu-lab-x1' })).toThrow('Unknown printer');
    expect(() => kiriProcess({ ...base, infill: 80 as Infill })).toThrow('Infill must be one of 10, 15, 20, 30 percent.');
    expect(() => kiriProcess({ ...base, quality: 'draft' as SliceSettings['quality'] })).toThrow('Unknown quality');
    expect(() => kiriProcess({ ...base, supports: 'yes' as unknown as boolean })).toThrow('Supports');
  });
});
