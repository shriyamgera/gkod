import { describe, expect, it } from 'vitest';
import { drawText, textWidth } from '../src/render/font.ts';
import { Raster, type Rgb } from '../src/render/raster.ts';

const WHITE: Rgb = [255, 255, 255];
const RED: Rgb = [255, 0, 0];
const BLUE: Rgb = [0, 0, 255];
const pixel = (r: Raster, x: number, y: number) => [...r.color.subarray((y * r.width + x) * 3, (y * r.width + x) * 3 + 3)];

describe('Raster.triangle', () => {
  it('fills the pixels whose centres are inside, in either winding', () => {
    for (const flip of [false, true]) {
      const r = new Raster(10, 10, WHITE);
      const [a, b, c] = [[0, 0, 0], [10, 0, 0], [0, 10, 0]] as [number, number, number][];
      if (flip) r.triangle(a!, c!, b!, RED, 7);
      else r.triangle(a!, b!, c!, RED, 7);
      expect(pixel(r, 1, 1)).toEqual(RED);
      expect(pixel(r, 8, 8)).toEqual(WHITE);
      expect(r.face[1 * 10 + 1]).toBe(7);
      expect(r.face[8 * 10 + 8]).toBe(-1);
    }
  });

  it('keeps the surface nearest the camera whatever the drawing order', () => {
    const r = new Raster(4, 4, WHITE);
    const square = (z: number, rgb: Rgb, id: number) => {
      r.triangle([0, 0, z], [4, 0, z], [4, 4, z], rgb, id);
      r.triangle([0, 0, z], [4, 4, z], [0, 4, z], rgb, id);
    };
    square(5, RED, 1);
    square(2, BLUE, 2);
    expect(pixel(r, 2, 2)).toEqual(RED);
    square(9, BLUE, 3);
    expect(pixel(r, 2, 2)).toEqual(BLUE);
    expect(r.face[10]).toBe(3);
  });

  it('only marks coverage when given a mask', () => {
    const r = new Raster(4, 4, WHITE);
    const mask = new Uint8Array(16);
    r.triangle([0, 0, 0], [4, 0, 0], [0, 4, 0], RED, 1, mask);
    expect(mask[0]).toBe(1);
    expect(pixel(r, 0, 0)).toEqual(WHITE);
  });
});

describe('Raster.line', () => {
  it('hides a line behind a nearer surface and shows it in front', () => {
    const r = new Raster(20, 20, WHITE);
    r.triangle([0, 0, 5], [20, 0, 5], [0, 20, 5], BLUE, 1);
    r.triangle([20, 0, 5], [20, 20, 5], [0, 20, 5], BLUE, 1);
    r.line([2, 10.5, 1], [18, 10.5, 1], 1, RED, 'pixel', 0.5);
    expect(pixel(r, 10, 10)).toEqual(BLUE);
    r.line([2, 10.5, 6], [18, 10.5, 6], 1, RED, 'middle', 0.5);
    expect(pixel(r, 10, 10)).toEqual(RED);
  });
});

describe('Raster.shrink', () => {
  it('averages each block', () => {
    const r = new Raster(2, 2, [0, 0, 0]);
    r.color.set([200, 100, 0], 0);
    expect([...r.shrink(2)]).toEqual([50, 25, 0]);
  });
});

describe('drawText', () => {
  it('writes digits at the given scale and skips characters it does not know', () => {
    const width = 40, height = 20;
    const rgb = new Uint8Array(width * height * 3);
    drawText(rgb, width, height, '1?', 0, 0, 2, [9, 9, 9]);
    const set = (x: number, y: number) => rgb[(y * width + x) * 3] === 9;
    // the top row of a "1" is its middle column, two pixels wide at scale 2
    expect(set(4, 0) && set(5, 1)).toBe(true);
    expect(set(0, 0)).toBe(false);
    // the second character starts 12 pixels in; "?" is not in the font
    for (let y = 0; y < height; y++) for (let x = 12; x < width; x++) expect(set(x, y)).toBe(false);
    expect(textWidth('12', 2)).toBe(22);
  });
});
