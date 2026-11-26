import { describe, expect, it } from 'vitest';
import { downloadName, modelName, versionLabel } from './names';

describe('versionLabel', () => {
  it('keeps a short change as typed, with a capital first letter', () => {
    expect(versionLabel('  make it 10 mm wider ')).toBe('Make it 10 mm wider');
  });

  it('uses the first line and squeezes spaces', () => {
    expect(versionLabel('thicker   walls\nand a bigger hole')).toBe('Thicker walls');
  });

  it('cuts a long change at a word', () => {
    const label = versionLabel('make the base much wider and add two screw holes near the back edge please');
    expect(label).toBe('Make the base much wider and add two screw holes…');
    expect(label.length).toBeLessThanOrEqual(49);
  });

  it('gives a plain label for an empty change', () => {
    expect(versionLabel('   ')).toBe('Change');
  });
});

describe('downloadName', () => {
  it('makes a file name from the title and version', () => {
    expect(downloadName('Phone stand', 3)).toBe('phone_stand_v3.stl');
    expect(downloadName('Wall hook, 2 screw holes!', 1)).toBe('wall_hook_2_screw_holes_v1.stl');
    expect(downloadName('Café shelf', 2)).toBe('cafe_shelf_v2.stl');
  });

  it('falls back to "part" when nothing is left', () => {
    expect(downloadName('…', 4)).toBe('part_v4.stl');
  });

  it('keeps long titles short', () => {
    const name = downloadName('a very long title for a part that goes on and on and on', 12);
    expect(name).toBe('a_very_long_title_for_a_part_that_goes_o_v12.stl');
  });
});

describe('modelName', () => {
  const models = [{ id: 'gemini-3.1-flash-lite', label: 'Gemini 3.1 Flash Lite' }];

  it('names a model on the menu, and shows the id of one that is not', () => {
    expect(modelName('gemini-3.1-flash-lite', models)).toBe('Gemini 3.1 Flash Lite');
    expect(modelName('gemini-9', models)).toBe('gemini-9');
    expect(modelName(undefined, models)).toBe('');
  });
});
