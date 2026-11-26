import { readFileSync, writeFileSync } from 'node:fs';
import { type CompileArgs, parseCommand, USAGE, UsageError } from './args.ts';
import { compileScad } from './compile.ts';

// Exit codes: 0 done, 1 the part failed (compile or checks), 2 wrong options or a file that cannot be read or written.
export async function main(argv: string[]): Promise<number> {
  try {
    const args = parseCommand(argv);
    if (args.command === 'help') {
      console.log(USAGE);
      return 0;
    }
    return await compileCommand(args);
  } catch (error) {
    if (error instanceof UsageError) {
      console.error(`${error.message}\n${USAGE}`);
      return 2;
    }
    console.error((error as Error).message);
    return 2;
  }
}

function readInput(path: string): string {
  try {
    return readFileSync(path === '-' ? 0 : path, 'utf8');
  } catch (error) {
    throw new Error(`Could not read ${path}: ${(error as NodeJS.ErrnoException).code ?? (error as Error).message}`);
  }
}

function write(path: string, data: Uint8Array): void {
  try {
    writeFileSync(path, data);
  } catch (error) {
    throw new Error(`Could not write ${path}: ${(error as NodeJS.ErrnoException).code ?? (error as Error).message}`);
  }
}

async function compileCommand(args: CompileArgs): Promise<number> {
  const result = await compileScad(readInput(args.input), args.defines);
  if (result.ok && args.out) write(args.out, result.stl!);
  const stl = result.ok ? args.out : null;
  const ms = Math.round(result.ms);
  if (args.json) {
    const { params, log, error, triangles } = result;
    console.log(JSON.stringify({ ok: result.ok, stl, triangles, params, log, ms, error }));
  } else if (result.ok) {
    console.log(`${args.input}: compiled in ${ms} ms, ${result.triangles} triangles${stl ? ` -> ${stl}` : ''}`);
  } else {
    console.error(`${args.input}: ${result.error}`);
  }
  return result.ok ? 0 : 1;
}
