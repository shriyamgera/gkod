import { describe, expect, it } from 'vitest';
import { cleanLog, findFailure, stlTriangles } from './errors';

describe('findFailure', () => {
  it('reports the first error with its line number', () => {
    const log = ['ERROR: Parser error: syntax error in file /in.scad, line 3', "Can't parse file '/in.scad'!"];
    expect(findFailure(1, log, 0)).toBe('Line 3: Parser error: syntax error');
  });

  it('keeps the text of a failed assert', () => {
    const log = [`ERROR: Assertion '(w > 0)' failed: "width must be positive" in file /in.scad, line 1`];
    expect(findFailure(1, log, 0)).toBe(`Line 1: Assertion '(w > 0)' failed: "width must be positive"`);
  });

  it('treats an error line as failure even when the exit code is 0', () => {
    expect(findFailure(0, ['ERROR: something odd'], 12)).toBe('something odd');
  });

  it('explains empty and flat results', () => {
    expect(findFailure(1, ['Current top level object is empty.'], 0)).toMatch(/solid shape/);
    expect(findFailure(1, ['Current top level object is not a 3D object.'], 0)).toMatch(/2D/);
    expect(findFailure(0, [], 0)).toMatch(/solid shape/);
  });

  it('explains a stack overflow', () => {
    expect(findFailure(-1, ['EXCEPTION: Maximum call stack size exceeded'], 0)).toMatch(/recursion/);
  });

  it('passes a clean compile, warnings included', () => {
    expect(findFailure(0, ['WARNING: Ignoring unknown variable "x" in file /in.scad, line 2'], 80)).toBeNull();
  });
});

describe('stlTriangles', () => {
  it('reads the count from the header', () => {
    const stl = new Uint8Array(84 + 50);
    new DataView(stl.buffer).setUint32(80, 1, true);
    expect(stlTriangles(stl)).toBe(1);
    expect(stlTriangles(new Uint8Array(84))).toBe(0);
    expect(stlTriangles(new Uint8Array(10))).toBe(0);
    expect(stlTriangles(null)).toBe(0);
  });
});

describe('cleanLog', () => {
  it('drops the localization notice and blank lines', () => {
    expect(cleanLog(["Could not initialize localization (application path is '/').", '', 'ECHO: 1'])).toEqual(['ECHO: 1']);
  });
});
