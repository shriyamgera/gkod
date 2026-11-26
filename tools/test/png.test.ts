import { crc32 as zlibCrc32, inflateSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { crc32, encodePng } from '../src/render/png.ts';

const bytes = (text: string) => new TextEncoder().encode(text);

type Chunk = { type: string; data: Buffer; crc: number; crcOf: number };

export function readChunks(png: Buffer): Chunk[] {
  const chunks: Chunk[] = [];
  for (let at = 8; at < png.length; ) {
    const length = png.readUInt32BE(at);
    const type = png.toString('latin1', at + 4, at + 8);
    chunks.push({
      type,
      data: png.subarray(at + 8, at + 8 + length),
      crc: png.readUInt32BE(at + 8 + length),
      crcOf: zlibCrc32(png.subarray(at + 4, at + 8 + length)),
    });
    at += 12 + length;
  }
  return chunks;
}

/** Undoes the encoder's rows (each a filter byte, 1 = difference from the pixel to the left) back into RGB bytes. */
export function decodePng(png: Buffer): { width: number; height: number; rgb: Uint8Array } {
  const chunks = readChunks(png);
  const header = chunks[0]!.data;
  const width = header.readUInt32BE(0), height = header.readUInt32BE(4);
  const rows = inflateSync(Buffer.concat(chunks.filter((c) => c.type === 'IDAT').map((c) => c.data)));
  const rgb = new Uint8Array(width * height * 3);
  const stride = width * 3;
  for (let y = 0; y < height; y++) {
    const filter = rows[y * (stride + 1)];
    if (filter !== 0 && filter !== 1) throw new Error(`unexpected filter ${filter}`);
    for (let i = 0; i < stride; i++) {
      const raw = rows[y * (stride + 1) + 1 + i]!;
      const left = filter === 1 && i >= 3 ? rgb[y * stride + i - 3]! : 0;
      rgb[y * stride + i] = (raw + left) & 0xff;
    }
  }
  return { width, height, rgb };
}

describe('crc32', () => {
  it('gives the published check values', () => {
    expect(crc32(bytes('123456789'))).toBe(0xcbf43926);
    expect(crc32(bytes('IEND'))).toBe(0xae426082);
    expect(crc32(new Uint8Array(0))).toBe(0);
  });

  it('matches zlib on random bytes', () => {
    const data = new Uint8Array(4096).map((_, i) => (i * 7919 + 13) & 0xff);
    expect(crc32(data)).toBe(zlibCrc32(data));
  });
});

describe('encodePng', () => {
  const width = 5, height = 3;
  const rgb = new Uint8Array(width * height * 3).map((_, i) => (i * 37) & 0xff);
  const png = encodePng(width, height, rgb);

  it('starts with the PNG signature and an RGB header', () => {
    expect([...png.subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
    const [ihdr] = readChunks(png);
    expect(ihdr!.type).toBe('IHDR');
    expect(ihdr!.data.length).toBe(13);
    expect(ihdr!.data.readUInt32BE(0)).toBe(width);
    expect(ihdr!.data.readUInt32BE(4)).toBe(height);
    expect([...ihdr!.data.subarray(8)]).toEqual([8, 2, 0, 0, 0]);
  });

  it('has IHDR, IDAT and IEND chunks with correct CRCs', () => {
    const chunks = readChunks(png);
    expect(chunks.map((c) => c.type)).toEqual(['IHDR', 'IDAT', 'IEND']);
    for (const c of chunks) expect(c.crc).toBe(c.crcOf);
    expect(chunks[2]!.data.length).toBe(0);
  });

  it('stores the pixels exactly', () => {
    expect(decodePng(png)).toEqual({ width, height, rgb });
  });

  it('refuses the wrong number of bytes', () => {
    expect(() => encodePng(2, 2, new Uint8Array(11))).toThrow(/Expected 12 bytes/);
  });
});
