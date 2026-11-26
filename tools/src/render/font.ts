// A 5 x 7 pixel font with just what a size label needs: "80 x 107.5 x 110 mm". Each row is five bits, left bit first.
const GLYPHS: Record<string, number[]> = {
  '0': [14, 17, 19, 21, 25, 17, 14],
  '1': [4, 12, 4, 4, 4, 4, 14],
  '2': [14, 17, 1, 2, 4, 8, 31],
  '3': [31, 2, 4, 2, 1, 17, 14],
  '4': [2, 6, 10, 18, 31, 2, 2],
  '5': [31, 16, 30, 1, 1, 17, 14],
  '6': [6, 8, 16, 30, 17, 17, 14],
  '7': [31, 1, 2, 4, 8, 8, 8],
  '8': [14, 17, 17, 14, 17, 17, 14],
  '9': [14, 17, 17, 15, 1, 2, 12],
  x: [0, 0, 17, 10, 4, 10, 17],
  m: [0, 0, 26, 21, 21, 17, 17],
  '.': [0, 0, 0, 0, 0, 12, 12],
  '-': [0, 0, 0, 31, 0, 0, 0],
  ' ': [0, 0, 0, 0, 0, 0, 0],
};

export const GLYPH_HEIGHT = 7;
const ADVANCE = 6;

export function textWidth(text: string, scale: number): number {
  return (text.length * ADVANCE - 1) * scale;
}

/** Writes text into an RGB picture with its top left corner at (x, y); characters the font lacks are left out. */
export function drawText(
  rgb: Uint8Array,
  width: number,
  height: number,
  text: string,
  x: number,
  y: number,
  scale: number,
  color: [number, number, number],
): void {
  [...text].forEach((char, n) => {
    const rows = GLYPHS[char];
    if (!rows) return;
    rows.forEach((bits, row) => {
      for (let col = 0; col < 5; col++) {
        if (!(bits & (16 >> col))) continue;
        for (let sy = 0; sy < scale; sy++) {
          for (let sx = 0; sx < scale; sx++) {
            const px = x + (n * ADVANCE + col) * scale + sx;
            const py = y + row * scale + sy;
            if (px < 0 || py < 0 || px >= width || py >= height) continue;
            rgb.set(color, (py * width + px) * 3);
          }
        }
      }
    });
  });
}
