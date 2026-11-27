#!/usr/bin/env node
// gkod-datagen: program-built training parts, with requests, code, compile and check labels.
// gkod-datagen edits: edit pairs made from those parts.
// gkod-datagen sets: the frozen train, dev and test sets, and their check.
import { main } from '../src/cli.ts';

const argv = process.argv.slice(2);
if (argv[0] === 'edits') {
  const { main: edits } = await import('../src/edits/cli.ts');
  process.exit(await edits(argv.slice(1)));
}
if (argv[0] === 'sets') {
  const { main: sets } = await import('../src/splits/cli.ts');
  process.exit(await sets(argv.slice(1)));
}
process.exit(await main(argv));
