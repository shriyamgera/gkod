import { describe, expect, it } from 'vitest';
import { describeMesh, parseStl } from './stl';

type Triangle = [number[], number[], number[]];

function binaryStl(triangles: Triangle[]): ArrayBuffer {
  const buf = new ArrayBuffer(84 + triangles.length * 50);
  const view = new DataView(buf);
  view.setUint32(80, triangles.length, true);
  triangles.forEach((corners, t) => {
    // The stored normal (first 12 bytes) is left as zero on purpose.
    let at = 84 + t * 50 + 12;
    for (const corner of corners) {
      for (const value of corner) {
        view.setFloat32(at, value, true);
        at += 4;
      }
    }
  });
  return buf;
}

// A tetrahedron with corners on the axes, faces wound to point outwards.
const o = [0, 0, 0];
const a = [10, 0, 0];
const b = [0, 20, 0];
const c = [0, 0, 5.25];
const tetrahedron: Triangle[] = [
  [o, b, a],
  [o, a, c],
  [o, c, b],
  [a, b, c],
];

describe('parseStl', () => {
  it('reads triangles and the bounding box', () => {
    const mesh = parseStl(binaryStl(tetrahedron));
    expect(mesh.triangles).toBe(4);
    expect(mesh.positions).toHaveLength(36);
    expect(mesh.normals).toHaveLength(36);
    expect(Array.from(mesh.positions.slice(0, 9))).toEqual([0, 0, 0, 0, 20, 0, 10, 0, 0]);
    expect(mesh.min).toEqual([0, 0, 0]);
    expect(mesh.max).toEqual([10, 20, 5.25]);
    expect(mesh.size).toEqual([10, 20, 5.25]);
  });

  it('works out face normals from the corners', () => {
    const mesh = parseStl(binaryStl(tetrahedron));
    // The first face lies on the bed and points down, for all three corners.
    expect(Array.from(mesh.normals.slice(0, 9))).toEqual([0, 0, -1, 0, 0, -1, 0, 0, -1]);
    const sloped = mesh.normals.slice(27, 30);
    expect(Math.hypot(...sloped)).toBeCloseTo(1, 5);
    expect(sloped.every((value) => value > 0)).toBe(true);
  });

  it('handles negative coordinates', () => {
    const mesh = parseStl(binaryStl([[[-5, -2, -1], [5, -2, -1], [0, 2, 3]]]));
    expect(mesh.min).toEqual([-5, -2, -1]);
    expect(mesh.size).toEqual([10, 4, 4]);
  });

  it('accepts a file with no triangles', () => {
    const mesh = parseStl(binaryStl([]));
    expect(mesh.triangles).toBe(0);
    expect(mesh.size).toEqual([0, 0, 0]);
  });

  it('rejects a buffer shorter than the header', () => {
    expect(() => parseStl(new ArrayBuffer(40))).toThrow(/too short/);
  });

  it('rejects a buffer cut off part way through', () => {
    const whole = binaryStl(tetrahedron);
    expect(() => parseStl(whole.slice(0, whole.byteLength - 30))).toThrow(
      /cut short: it says 4 triangles \(284 bytes\) but has 254 bytes/,
    );
  });

  it('says so when given a text STL', () => {
    const text = `solid part\n${' facet normal 0 0 1\n'.repeat(8)}endsolid part\n`;
    const bytes = new TextEncoder().encode(text);
    expect(() => parseStl(bytes.buffer as ArrayBuffer)).toThrow(/text STL/);
  });

  it('rejects values that are not numbers', () => {
    expect(() => parseStl(binaryStl([[[0, 0, 0], [1, NaN, 0], [0, 1, 0]]]))).toThrow(/triangle 1/);
  });
});

describe('describeMesh', () => {
  it('gives sizes in millimetres and a triangle count', () => {
    expect(describeMesh({ size: [80, 62, 70], triangles: 1240 })).toBe('80 x 62 x 70 mm, 1,240 triangles');
  });

  it('rounds sizes to one decimal place', () => {
    expect(describeMesh({ size: [20, 9.94, 103.449], triangles: 1 })).toBe('20 x 9.9 x 103.4 mm, 1 triangle');
  });
});
