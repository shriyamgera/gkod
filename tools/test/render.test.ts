import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseStl } from '../../app/src/viewer/stl.ts';
import { renderMesh } from '../src/render/render.ts';
import { decodePng } from './png.test.ts';

const fixture = (name: string) => {
  const bytes = readFileSync(new URL(`../../checks/test/fixtures/${name}.stl`, import.meta.url));
  return parseStl(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer).positions;
};

// a 10 mm cube standing on the bed, 12 triangles
function cube(): Float32Array {
  const c = (i: number) => [i & 1 ? 10 : 0, i & 2 ? 10 : 0, i & 4 ? 10 : 0];
  const faces = [
    [0, 2, 3, 1], [4, 5, 7, 6], [0, 1, 5, 4], [2, 6, 7, 3], [0, 4, 6, 2], [1, 3, 7, 5],
  ];
  return new Float32Array(faces.flatMap(([a, b, d, e]) => [...c(a!), ...c(b!), ...c(d!), ...c(a!), ...c(d!), ...c(e!)]));
}

// the box around the dark ink pixels above the size label
function inkBox(rgb: Uint8Array, width: number, height: number) {
  let [left, right, top, low] = [width, -1, height, -1];
  for (let y = 0; y < height * 0.85; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 3;
      if (Math.max(rgb[i]!, rgb[i + 1]!, rgb[i + 2]!) < 130) {
        left = Math.min(left, x);
        right = Math.max(right, x);
        top = Math.min(top, y);
        low = Math.max(low, y);
      }
    }
  }
  return { left, right, top, low };
}

describe('renderMesh', () => {
  for (const name of ['phone_stand', 'wall_hook', 'cable_clip']) {
    it(`draws the whole ${name} inside the picture in every view`, () => {
      for (const view of ['iso', 'front', 'side', 'top'] as const) {
        const picture = renderMesh(fixture(name), { size: 300, view });
        const { width, height, rgb } = decodePng(picture.png);
        expect([width, height]).toEqual([picture.width, picture.height]);
        expect(width).toBe(300);
        const box = inkBox(rgb, width, height);
        expect(box.right).toBeGreaterThan(box.left);
        expect(box.left).toBeGreaterThanOrEqual(5);
        expect(box.top).toBeGreaterThanOrEqual(5);
        expect(box.right).toBeLessThan(width - 5);
      }
    });
  }

  it('gives a part its size and triangle count', () => {
    const picture = renderMesh(cube(), { size: 200 });
    expect(picture.triangles).toBe(12);
    expect(picture.size).toEqual([10, 10, 10]);
  });

  it('draws marked faces in the accent colour', () => {
    const plain = decodePng(renderMesh(cube(), { size: 200 }).png).rgb;
    const marked = decodePng(renderMesh(cube(), { size: 200, marked: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11] }).png).rgb;
    const orange = (rgb: Uint8Array) => {
      let n = 0;
      for (let i = 0; i < rgb.length; i += 3) if (rgb[i]! > 150 && rgb[i]! - rgb[i + 2]! > 80) n++;
      return n;
    };
    expect(orange(plain)).toBe(0);
    expect(orange(marked)).toBeGreaterThan(1000);
  });

  it('refuses a part with no triangles', () => {
    expect(() => renderMesh(new Float32Array(0))).toThrow(/no triangles/);
  });
});
