import { type ParseArgsOptionsConfig, parseArgs } from 'node:util';

export class UsageError extends Error {}

export const USAGE = `Usage:
  gkod compile <file.scad|-> [-o out.stl] [-D name=value ...] [--json]`;

export type CompileArgs = {
  command: 'compile';
  input: string;
  out: string | null;
  defines: Record<string, number>;
  json: boolean;
};

export type Args = { command: 'help' } | CompileArgs;

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
  throw new UsageError(`Unknown command "${command}".`);
}
