#!/usr/bin/env node
// gkod-datagen: program-built training parts, with requests, code, compile and check labels.
// gkod-datagen edits: edit pairs made from those parts.
import { main } from '../src/cli.ts';

const argv = process.argv.slice(2);
if (argv[0] === 'edits') {
  const { main: edits } = await import('../src/edits/cli.ts');
  process.exit(await edits(argv.slice(1)));
}
process.exit(await main(argv));
