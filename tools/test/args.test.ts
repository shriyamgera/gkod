import { describe, expect, it } from 'vitest';
import { outputBeside, parseCommand, parseDefines, UsageError } from '../src/args.ts';

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
