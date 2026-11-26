#!/usr/bin/env node
// Runs the print checks on binary STL files.
//   gkod-check part.stl [more.stl ...] [--bed 256x256x256] [--overhang 45] [--json]
// A path of "-" reads the file from standard input.
// Exit code: 0 when every file passes, 1 when a check fails, 2 when a file cannot be read or the options are wrong.
import { readFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { checkStl } from '../src/index.ts';

const usage = 'Usage: gkod-check part.stl [more.stl ...] [--bed 256x256x256] [--overhang 45] [--json]';

function fail(message) {
  console.error(`${message}\n${usage}`);
  process.exit(2);
}

let args;
try {
  args = parseArgs({
    allowPositionals: true,
    options: {
      bed: { type: 'string' },
      overhang: { type: 'string' },
      json: { type: 'boolean', default: false },
      help: { type: 'boolean', short: 'h', default: false },
    },
  });
} catch (error) {
  fail(error.message);
}

const { values, positionals: files } = args;
if (values.help) {
  console.log(usage);
  process.exit(0);
}
if (files.length === 0) fail('Give at least one STL file.');

const opts = {};
if (values.bed !== undefined) {
  const sides = values.bed.split('x').map(Number);
  const [x, y = x, z = x] = sides;
  if (sides.length !== 1 && sides.length !== 3) fail(`--bed takes one size or three, like 256x256x256, not "${values.bed}".`);
  if (![x, y, z].every((side) => Number.isFinite(side) && side > 0)) fail(`--bed sizes must be numbers above zero, not "${values.bed}".`);
  opts.bed = { x, y, z };
}
if (values.overhang !== undefined) {
  const deg = Number(values.overhang);
  if (!(deg >= 0 && deg <= 90)) fail(`--overhang takes degrees from 0 to 90, not "${values.overhang}".`);
  opts.overhangDeg = deg;
}

const mm = (value) => String(Math.round(value * 10) / 10);
let code = 0;

for (const file of files) {
  let report;
  try {
    report = checkStl(readFileSync(file === '-' ? 0 : file), opts);
  } catch (error) {
    code = 2;
    if (values.json) console.log(JSON.stringify({ file, error: error.message }));
    else console.error(`${file}: ${error.message}`);
    continue;
  }
  if (!report.ok && code === 0) code = 1;
  if (values.json) {
    console.log(JSON.stringify({ file, ...report }));
    continue;
  }
  const { triangles, size } = report.stats;
  console.log(
    `${file}: ${report.ok ? 'ready to print' : 'needs changes'} ` +
      `(${triangles} triangles, ${size.map(mm).join(' x ')} mm, checked in ${report.ms.toFixed(1)} ms)`,
  );
  for (const result of report.results) {
    console.log(`  ${result.ok ? 'pass' : 'FAIL'}  ${result.title}${result.ok ? '' : `: ${result.detail}`}`);
  }
}

process.exit(code);
