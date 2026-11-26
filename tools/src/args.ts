import { type ParseArgsOptionsConfig, parseArgs } from 'node:util';
import type { Bed } from '@gkod/checks';
import { DEFAULT_PRINTER, PRINTERS } from './printers.ts';

export class UsageError extends Error {}

export const USAGE = `Usage:
  gkod compile <file.scad|-> [-o out.stl] [-D name=value ...] [--json]
  gkod check <file.stl> [--printer ${Object.keys(PRINTERS).join('|')} | --bed 220x220x250] [--json]`;

export type CompileArgs = {
  command: 'compile';
  input: string;
  out: string | null;
  defines: Record<string, number>;
  json: boolean;
};

export type CheckArgs = {
  command: 'check';
  input: string;
  // the printer's key, or "custom" for a --bed size
  printer: string;
  bed: Bed;
  json: boolean;
};

export type Args = { command: 'help' } | CompileArgs | CheckArgs;

const NAME = /^[A-Za-z_]\w*$/;

// "-D width=100" sets one named size; only numbers, as the site's sliders do.
export function parseDefines(list: string[] = []): Record<string, number> {
  const defines: Record<string, number> = {};
  for (const raw of list) {
    const at = raw.indexOf('=');
    const name = raw.slice(0, at).trim();
    const value = Number(raw.slice(at + 1).trim());
    if (at < 1 || !NAME.test(name) || raw.slice(at + 1).trim() === '' || !Number.isFinite(value)) {
      throw new UsageError(`-D takes name=number, like -D width=100, not "${raw}".`);
    }
    defines[name] = value;
  }
  return defines;
}

// "256" or "250x210x220", in mm.
export function parseBed(text: string): Bed {
  const sides = text.split('x').map(Number);
  const [x = NaN, y = x, z = x] = sides;
  if (sides.length !== 1 && sides.length !== 3) throw new UsageError(`--bed takes one size or three, like 220x220x250, not "${text}".`);
  if (![x, y, z].every((side) => Number.isFinite(side) && side > 0)) {
    throw new UsageError(`--bed sizes must be numbers above zero, not "${text}".`);
  }
  return { x, y, z };
}

export function pickPrinter(printer?: string, bed?: string): { printer: string; bed: Bed } {
  if (printer !== undefined && bed !== undefined) throw new UsageError('Give --printer or --bed, not both.');
  if (bed !== undefined) return { printer: 'custom', bed: parseBed(bed) };
  const key = printer ?? DEFAULT_PRINTER;
  const known = PRINTERS[key];
  if (!known) throw new UsageError(`Unknown printer "${key}". Known printers: ${Object.keys(PRINTERS).join(', ')}.`);
  return { printer: key, bed: known.bed };
}

// Without -o the output goes beside the input with a new extension; standard input has no such place.
export function outputBeside(input: string, extension: string): string | null {
  if (input === '-') return null;
  return input.replace(/\.[^./\\]*$/, '') + extension;
}

function read(argv: string[], options: ParseArgsOptionsConfig) {
  try {
    return parseArgs({ args: argv, allowPositionals: true, options });
  } catch (error) {
    throw new UsageError((error as Error).message);
  }
}

function onePath(positionals: string[], what: string): string {
  if (positionals.length === 0) throw new UsageError(`Give ${what}.`);
  if (positionals.length > 1) throw new UsageError(`Give one file, not ${positionals.length}.`);
  return positionals[0]!;
}

export function parseCommand(argv: string[]): Args {
  const [command, ...rest] = argv;
  if (!command || command === 'help' || command === '--help' || command === '-h') return { command: 'help' };
  if (command === 'compile') {
    const { values, positionals } = read(rest, {
      out: { type: 'string', short: 'o' },
      define: { type: 'string', short: 'D', multiple: true },
      json: { type: 'boolean', default: false },
    });
    const input = onePath(positionals, 'an OpenSCAD file, or - for standard input');
    return {
      command,
      input,
      out: (values.out as string | undefined) ?? outputBeside(input, '.stl'),
      defines: parseDefines(values.define as string[] | undefined),
      json: values.json === true,
    };
  }
  if (command === 'check') {
    const { values, positionals } = read(rest, {
      printer: { type: 'string' },
      bed: { type: 'string' },
      json: { type: 'boolean', default: false },
    });
    const input = onePath(positionals, 'an STL file');
    const picked = pickPrinter(values.printer as string | undefined, values.bed as string | undefined);
    return { command, input, ...picked, json: values.json === true };
  }
  throw new UsageError(`Unknown command "${command}".`);
}
