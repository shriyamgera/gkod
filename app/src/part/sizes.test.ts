import { describe, expect, it } from 'vitest';
import phoneStand from '../examples/phone_stand.scad?raw';
import { parseParams } from '../scad/params';
import exported from '../scad/fixtures/phone_stand.param.json?raw';
import { describeParam, fitToParam, labelOf, optionIndex, stlFileName, withValues } from './sizes';

const params = parseParams(exported);

describe('labelOf', () => {
  it('turns a code name into a short label', () => {
    expect(labelOf('width')).toBe('Width');
    expect(labelOf('cable_slot')).toBe('Cable slot');
    expect(labelOf('screw_d')).toBe('Screw diameter');
    expect(labelOf('pad_thickness')).toBe('Pad thickness');
  });
});

describe('describeParam', () => {
  it('splits the unit off the caption', () => {
    expect(describeParam(params[0]!)).toEqual({
      label: 'Width',
      unit: 'mm',
      unitName: 'millimetres',
      help: 'Stand width',
    });
  });

  it('shows degrees as a degree sign', () => {
    const angle = params.find((param) => param.name === 'angle')!;
    expect(describeParam(angle)).toMatchObject({ unit: '°', unitName: 'degrees', help: 'Back plate angle from the table' });
  });

  it('takes a size with no caption as mm', () => {
    expect(describeParam({ name: 'lip' })).toEqual({ label: 'Lip', unit: 'mm', unitName: 'millimetres' });
  });

  it('drops help text that only repeats the label', () => {
    expect(describeParam({ name: 'cable_d', caption: 'Cable diameter (mm)' })).toEqual({
      label: 'Cable diameter',
      unit: 'mm',
      unitName: 'millimetres',
    });
    expect(describeParam({ name: 'pad_width', caption: 'pad width' }).help).toBeUndefined();
  });

  it('keeps an unknown unit as written', () => {
    expect(describeParam({ name: 'rows', caption: 'Rows of holes (holes)' })).toMatchObject({
      unit: 'holes',
      help: 'Rows of holes',
    });
  });
});

describe('fitToParam', () => {
  const thickness = { min: 3, max: 8, step: 0.5 };

  it('keeps values inside the range', () => {
    expect(fitToParam(2, thickness)).toBe(3);
    expect(fitToParam(20, thickness)).toBe(8);
  });

  it('snaps to the nearest step', () => {
    expect(fitToParam(5.3, thickness)).toBe(5.5);
    expect(fitToParam(5.2, thickness)).toBe(5);
  });

  it('does not leave floating point noise', () => {
    expect(fitToParam(1.4, { min: 1.2, max: 3, step: 0.2 })).toBe(1.4);
  });

  it('falls back to the low end for a value that is not a number', () => {
    expect(fitToParam(Number.NaN, thickness)).toBe(3);
  });

  it('only gives values from the list when the code lists them', () => {
    const teeth = { min: 12, max: 32, step: 4, options: [12, 16, 20, 32] };
    expect(fitToParam(24, teeth)).toBe(20);
    expect(fitToParam(28, teeth)).toBe(32);
    expect(fitToParam(100, teeth)).toBe(32);
    const results = [12, 14, 16, 18, 20, 22, 24, 26, 28, 30, 32].map((value) => fitToParam(value, teeth));
    expect(results.every((value) => teeth.options.includes(value))).toBe(true);
  });
});

describe('optionIndex', () => {
  it('finds the position of the nearest listed value', () => {
    expect(optionIndex(8, [3, 4, 5, 6, 8])).toBe(4);
    expect(optionIndex(7.9, [3, 4, 5, 6, 8])).toBe(4);
    expect(optionIndex(3, [3, 4, 5, 6, 8])).toBe(0);
  });
});

describe('stlFileName', () => {
  it('names the file after the part and its first size in mm', () => {
    expect(stlFileName('phone_stand', params)).toBe('phone_stand_80mm.stl');
    expect(stlFileName('phone_stand', [{ ...params[0]!, value: 95.5 }])).toBe('phone_stand_95.5mm.stl');
  });

  it('uses the plain id when no size is in mm', () => {
    expect(stlFileName('dial', [{ name: 'turn', value: 30, min: 0, max: 90, step: 1, caption: 'Turn (degrees)' }])).toBe(
      'dial.stl',
    );
  });
});

describe('withValues', () => {
  it('writes changed sizes into the code', () => {
    const code = withValues(phoneStand, { width: 120, thickness: 6.5 });
    expect(code).toContain('width = 120; // [50:1:160]');
    expect(code).toContain('thickness = 6.5; // [3:0.5:8]');
    expect(code).toContain('depth = 90; // [70:1:140]');
  });

  it('leaves the code alone when nothing changed', () => {
    expect(withValues(phoneStand, { width: 80 })).toBe(phoneStand);
  });

  it('only touches top-level lines', () => {
    const code = withValues('w = 1;\nmodule m() {\n  w = 2;\n}\n', { w: 5 });
    expect(code).toBe('w = 5;\nmodule m() {\n  w = 2;\n}\n');
  });
});
