#!/usr/bin/env node
// gkod-datagen: program-built training parts, with requests, code, compile and check labels.
import { main } from '../src/cli.ts';

process.exit(await main(process.argv.slice(2)));
