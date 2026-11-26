#!/usr/bin/env node
// Runs the G-code safety check on files, reading each one line by line from disk.
//   node scripts/check-gcode.mjs <file.gcode | folder> [...] [--printer <id>]
// Without --printer, a file named "<printer id>__<part>.gcode" is checked against that printer's bed.
// Exit code: 0 when every file passes, 1 when one fails, 2 when the options or a file cannot be read.
import { createReadStream, readdirSync, statSync } from 'node:fs';
import { basename, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { createGcodeChecker, createLineSplitter, DEFAULT_ALLOWED, PLA_LIMITS } from '../checks/src/index.ts';
import { printers } from '../app/src/slicer/printers.ts';

export function printerFor(file, id) {
  const wanted = id ?? basename(file).split('__')[0];
  const printer = printers.find((item) => item.id === wanted);
  if (!printer) throw new Error(`${basename(file)}: no printer "${wanted}"; use --printer with one of ${printers.map((p) => p.id).join(', ')}`);
  return printer;
}

export async function checkGcodeFile(file, printer) {
  const checker = createGcodeChecker({ bed: printer.bed, ...PLA_LIMITS, allowed: DEFAULT_ALLOWED });
  // the same line splitting as the site: "\r\n", "\r" and "\n" each end a line, as on the printer
  const lines = createLineSplitter(checker.line);
  for await (const chunk of createReadStream(file, { encoding: 'utf8' })) lines.push(chunk);
  lines.end();
  return checker.finish();
}

function gcodeFiles(paths) {
  return paths.flatMap((path) =>
    statSync(path).isDirectory()
      ? readdirSync(path).filter((name) => name.endsWith('.gcode')).sort().map((name) => join(path, name))
      : [path],
  );
}

async function main() {
  const { values, positionals } = parseArgs({ allowPositionals: true, options: { printer: { type: 'string' } } });
  if (!positionals.length) throw new Error('Usage: node scripts/check-gcode.mjs <file.gcode | folder> [...] [--printer <id>]');
  let failed = 0;
  for (const file of gcodeFiles(positionals)) {
    const printer = printerFor(file, values.printer);
    const report = await checkGcodeFile(file, printer);
    const { lines, fanOnLayer, extruderMode, maxX, maxY, maxZ } = report.stats;
    const where = `max X ${maxX.toFixed(1)} Y ${maxY.toFixed(1)} Z ${maxZ.toFixed(2)}`;
    console.log(`${report.ok ? 'pass' : 'FAIL'}  ${basename(file)}  ${printer.name}  ${lines} lines, ${where}, fan from layer ${fanOnLayer}, ${extruderMode} E`);
    for (const problem of report.problems) console.log(`      line ${problem.line}: ${problem.reason}  (${problem.text})`);
    if (!report.ok) failed++;
  }
  process.exitCode = failed ? 1 : 0;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 2;
  });
}
