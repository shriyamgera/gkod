import { readFileSync, writeFileSync } from 'node:fs';
import { checkStl } from '@gkod/checks';
import { parseStl } from '../../app/src/viewer/stl.ts';
import { type CheckArgs, type CompileArgs, parseCommand, type RenderArgs, USAGE, UsageError } from './args.ts';
import { bedText, reportLines } from './check.ts';
import { compileScad } from './compile.ts';
import { PRINTERS } from './printers.ts';
import { renderMesh } from './render/render.ts';

// Exit codes: 0 done, 1 the part failed (compile or checks), 2 wrong options or a file that cannot be read or written.
export async function main(argv: string[]): Promise<number> {
  try {
    const args = parseCommand(argv);
    if (args.command === 'help') {
      console.log(USAGE);
      return 0;
    }
    if (args.command === 'check') return checkCommand(args);
    if (args.command === 'render') return await renderCommand(args);
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

function readInput(path: string): string;
function readInput(path: string, binary: true): Uint8Array;
function readInput(path: string, binary = false): string | Uint8Array {
  try {
    const file = path === '-' ? 0 : path;
    return binary ? readFileSync(file) : readFileSync(file, 'utf8');
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

function checkCommand(args: CheckArgs): number {
  const printer = PRINTERS[args.printer]?.name ?? `a ${bedText(args.bed)} bed`;
  const report = checkStl(readInput(args.input, true), { bed: args.bed });
  if (args.json) {
    console.log(JSON.stringify({ file: args.input, printer: args.printer, printerName: printer, bed: args.bed, ...report }));
  } else {
    console.log(reportLines(args.input, report, printer).join('\n'));
  }
  return report.ok ? 0 : 1;
}

async function renderCommand(args: RenderArgs): Promise<number> {
  let stl: Uint8Array;
  if (/\.scad$/i.test(args.input)) {
    const result = await compileScad(readInput(args.input), args.defines);
    if (!result.ok) {
      if (args.json) console.log(JSON.stringify({ ok: false, png: null, error: result.error }));
      else console.error(`${args.input}: ${result.error}`);
      return 1;
    }
    stl = result.stl!;
  } else {
    stl = readInput(args.input, true);
  }
  const mesh = parseStl(stl.buffer.slice(stl.byteOffset, stl.byteOffset + stl.byteLength) as ArrayBuffer);
  const marked = args.markOverhangs ? (checkStl(stl).results.find((r) => r.id === 'overhang')?.triangles ?? []) : [];
  const picture = renderMesh(mesh.positions, { size: args.size, view: args.view, marked });
  write(args.out, picture.png);
  const size = picture.size.map((value) => Math.round(value * 10) / 10);
  if (args.json) {
    const { triangles, grid } = picture;
    console.log(JSON.stringify({ ok: true, png: args.out, view: args.view, size, triangles, grid, marked: marked.length }));
  } else {
    console.log(`${args.out}: ${args.view} view, ${size.join(' x ')} mm, ${picture.triangles} triangles${marked.length ? `, ${marked.length} marked` : ''}`);
  }
  return 0;
}
