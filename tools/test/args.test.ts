import { describe, expect, it } from 'vitest';
import { outputBeside, parseBed, parseCommand, parseDefines, pickPrinter, UsageError } from '../src/args.ts';

describe('compile options', () => {
  it('reads the file, output and sizes', () => {
    expect(parseCommand(['compile', 'part.scad', '-o', 'out.stl', '-D', 'width=100', '-D', 'angle=62.5', '--json'])).toEqual({
      command: 'compile',
      input: 'part.scad',
      out: 'out.stl',
      defines: { width: 100, angle: 62.5 },
      json: true,
    });
  });

  it('puts the STL beside the code when no output is given', () => {
    expect(parseCommand(['compile', 'parts/hook.scad'])).toMatchObject({ out: 'parts/hook.stl', defines: {}, json: false });
    expect(parseCommand(['compile', '-'])).toMatchObject({ input: '-', out: null });
  });

  it('refuses sizes that are not name=number', () => {
    for (const bad of ['width', '=3', 'width=', 'width=abc', '2w=3', 'w-d=3', 'size=[1,2]']) {
      expect(() => parseDefines([bad])).toThrow(UsageError);
    }
    expect(parseDefines(['w=-2', ' h = 1e2 '])).toEqual({ w: -2, h: 100 });
  });

  it('needs exactly one file', () => {
    expect(() => parseCommand(['compile'])).toThrow(/Give an OpenSCAD file/);
    expect(() => parseCommand(['compile', 'a.scad', 'b.scad'])).toThrow(/one file/);
  });

  it('turns unknown options and commands into usage errors', () => {
    expect(() => parseCommand(['compile', 'a.scad', '--fast'])).toThrow(UsageError);
    expect(() => parseCommand(['slice', 'a.stl'])).toThrow(/Unknown command "slice"/);
    expect(parseCommand([])).toEqual({ command: 'help' });
    expect(parseCommand(['--help'])).toEqual({ command: 'help' });
  });
});

describe('outputBeside', () => {
  it('swaps the last extension only', () => {
    expect(outputBeside('a/b.c/part.stl', '.png')).toBe('a/b.c/part.png');
    expect(outputBeside('part', '.stl')).toBe('part.stl');
    expect(outputBeside('-', '.stl')).toBeNull();
  });
});

describe('check options', () => {
  it('uses the Kobra 2 Neo unless told otherwise', () => {
    expect(parseCommand(['check', 'part.stl'])).toEqual({
      command: 'check',
      input: 'part.stl',
      printer: 'kobra2neo',
      bed: { x: 220, y: 220, z: 250 },
      json: false,
    });
  });

  it('takes a known printer or a bed size', () => {
    expect(parseCommand(['check', 'p.stl', '--printer', 'mk4', '--json'])).toMatchObject({
      printer: 'mk4',
      bed: { x: 250, y: 210, z: 220 },
      json: true,
    });
    expect(pickPrinter(undefined, '300')).toEqual({ printer: 'custom', bed: { x: 300, y: 300, z: 300 } });
    expect(parseBed('250x210x220')).toEqual({ x: 250, y: 210, z: 220 });
  });

  it('refuses unknown printers, both options at once and bad beds', () => {
    expect(() => pickPrinter('x9')).toThrow(/Known printers: kobra2neo, p1s, a1, ender3v2, mk4/);
    expect(() => pickPrinter('p1s', '200')).toThrow(/not both/);
    for (const bad of ['200x200', '0', 'axbxc', '-5x10x10', '']) expect(() => parseBed(bad)).toThrow(UsageError);
  });
});

describe('render options', () => {
  it('has defaults for size, view and output', () => {
    expect(parseCommand(['render', 'parts/hook.stl'])).toEqual({
      command: 'render',
      input: 'parts/hook.stl',
      out: 'parts/hook.png',
      size: 900,
      view: 'iso',
      markOverhangs: false,
      defines: {},
      json: false,
    });
  });

  it('reads every option', () => {
    expect(
      parseCommand(['render', 'a.scad', '-o', 'b.png', '--size', '400', '--view', 'top', '--mark-overhangs', '-D', 'w=3', '--json']),
    ).toEqual({ command: 'render', input: 'a.scad', out: 'b.png', size: 400, view: 'top', markOverhangs: true, defines: { w: 3 }, json: true });
  });

  it('refuses bad sizes, views and standard input', () => {
    for (const size of ['12', '4001', '300.5', 'big']) expect(() => parseCommand(['render', 'a.stl', '--size', size])).toThrow(/--size/);
    expect(() => parseCommand(['render', 'a.stl', '--view', 'back'])).toThrow(/--view takes iso, front, side, top/);
    expect(() => parseCommand(['render', '-'])).toThrow(/standard input/);
  });
});
