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

  it('explains a stack overflow in each form it takes', () => {
    for (const thrown of ['Maximum call stack size exceeded', 'memory access out of bounds', 'table index is out of bounds', 'unreachable', '1393976']) {
      expect(findFailure(-1, [`EXCEPTION: ${thrown}`], 0)).toMatch(/ran out of room.*recursion/);
    }
    expect(findFailure(-1, ['EXCEPTION: something else 12'], 0)).toBe('The compiler stopped: something else 12');
  });

  it('explains a part too detailed to build', () => {
    expect(findFailure(1, ["WARNING: GeometryEvaluator: Node didn't fit into cache."], 0)).toBe(
      'The part is too detailed to build; lower $fn or use fewer pieces.',
    );
  });

  it('reports the warning that stopped the compile', () => {
    const log = ['WARNING: Ignoring unknown variable "undefined_width" in file /in.scad, line 1', "TRACE: called by 'cube'"];
    expect(findFailure(1, log, 0)).toBe('Line 1: Unknown variable "undefined_width"');
    expect(findFailure(1, ["WARNING: Ignoring unknown module 'no_such_module' in file /in.scad, line 3"], 0)).toBe(
      "Line 3: Unknown module 'no_such_module'",
    );
  });

  it('names the missing include rather than the stop it caused', () => {
    const log = [
      "WARNING: Can't find include file 'nothere.scad'. in file /in.scad, line 1",
      'ERROR: Parser error: stop on first warning in file /in.scad, line 1',
      "Can't parse file '/in.scad'!",
    ];
    expect(findFailure(1, log, 0)).toBe("Line 1: Can't find include file 'nothere.scad'.");
  });

  it('passes a clean compile, including warnings that did not stop it', () => {
    expect(findFailure(0, ['WARNING: [manifold] Minkowski failed with error, falling back to Nef operation'], 80)).toBeNull();
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
